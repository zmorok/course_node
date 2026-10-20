import { AppError } from '../utils/app-error.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { newRefreshToken, hashRefreshToken, isRefreshToken } from '../utils/tokens.js';

const unauthorized = () => new AppError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт');
const blocked = () => new AppError(403, 'ACCOUNT_BLOCKED', 'Аккаунт заблокирован');
const isBlocked = user => user.status === 'BLOCKED' && (!user.blocked_until || new Date(user.blocked_until).getTime() > Date.now());
function publicUser(user) {
  return { id: user.id, email: user.email, username: user.username, role: user.role,
    status: isBlocked(user) ? 'BLOCKED' : 'ACTIVE', firstName: user.first_name, lastName: user.last_name };
}

export async function createAuthService({ repository, transaction, accessTokens, sessionTtlDays }) {
  // Unknown emails still perform the same password-hash verification.
  const dummyHash = await hashPassword(newRefreshToken());
  async function issue(repo, user) {
    const refreshToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + sessionTtlDays * 86400000);
    const session = await repo.createSession(user.id, expiresAt, hashRefreshToken(refreshToken));
    return { user: publicUser(user), accessToken: await accessTokens.sign(user.id, session.id), refreshToken, expiresAt: session.expires_at };
  }
  return {
    async register(input) {
      const passwordHash = await hashPassword(input.password);
      try {
        return await transaction(async repo => {const user=await repo.createUser({ ...input, passwordHash });return issue(repo,user);});
      } catch (error) {
        if (error.code === '23505') throw new AppError(409, 'ACCOUNT_EXISTS', 'Email или имя пользователя уже заняты');
        throw error;
      }
    },
    async login({ email, password }) {
      const user = await repository.findByEmail(email);
      const matches = await verifyPassword(user?.password_hash ?? dummyHash, password);
      if (!user || !matches) throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
      if (isBlocked(user)) throw blocked();
      return transaction(async repo => {const current=await repo.lockForLogin(user.id);if(!current||current.email.toLowerCase()!==email.toLowerCase()||current.password_hash!==user.password_hash&&!await verifyPassword(current.password_hash,password))throw new AppError(401,'INVALID_CREDENTIALS','Неверный email или пароль');if(isBlocked(current))throw blocked();const result=await issue(repo,current);return result;});
    },
    async refresh(token) {
      if (!isRefreshToken(token)) throw unauthorized();
      const digest = hashRefreshToken(token);
      const result = await transaction(async repo => {
        const user = await repo.findRefreshForUpdate(digest);
        if (!user || user.revoked_at || new Date(user.expires_at).getTime() <= Date.now()) return { error: unauthorized() };
        if (user.consumed_at || isBlocked(user)) {
          await repo.revokeSession(user.session_id);
          return { error: isBlocked(user) ? blocked() : unauthorized() };
        }
        const refreshToken = newRefreshToken();
        await repo.consumeRefreshToken(digest);
        await repo.addRefreshToken(user.session_id, hashRefreshToken(refreshToken));
        return { user: publicUser(user), accessToken: await accessTokens.sign(user.id, user.session_id), refreshToken, expiresAt: user.expires_at };
      });
      // Throw only after the revocation transaction commits.
      if (result.error) throw result.error;
      return result;
    },
    async authenticate(token) {
      let identity;
      try { identity = await accessTokens.verify(token); } catch { throw unauthorized(); }
      const user = await repository.findCurrentUser(identity.sessionId, identity.userId);
      if (!user) throw unauthorized();
      if (isBlocked(user)) throw blocked();
      return publicUser(user);
    },
    async logout(token) {
      if(isRefreshToken(token))await transaction(async repo=>{const user=await repo.findRefreshForUpdate(hashRefreshToken(token));if(user&&!user.revoked_at){await repo.revokeSession(user.session_id);}});
    },
  };
}
