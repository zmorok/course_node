import { AppError } from '../utils/app-error.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { newRefreshToken, hashRefreshToken, isRefreshToken } from '../utils/tokens.js';

const unauthorized = () => new AppError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт');
const blocked = () => new AppError(403, 'ACCOUNT_BLOCKED', 'Аккаунт заблокирован');
const isAccountBlocked = (user) =>
  user.status === 'BLOCKED' &&
  (!user.blocked_until || new Date(user.blocked_until).getTime() > Date.now());

function toPublicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    status: isAccountBlocked(user) ? 'BLOCKED' : 'ACTIVE',
    firstName: user.first_name,
    lastName: user.last_name,
  };
}

export async function createAuthService({ repository, transaction, accessTokens, sessionTtlDays }) {
  // Unknown emails still perform the same password-hash verification.
  const dummyHash = await hashPassword(newRefreshToken());

  async function issueSession(transactionRepository, user) {
    await transactionRepository.touchPresence(user.id);

    const refreshToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + sessionTtlDays * 86400000);

    const session = await transactionRepository.createSession(
      user.id,
      expiresAt,
      hashRefreshToken(refreshToken),
    );

    return {
      user: toPublicUser(user),
      accessToken: await accessTokens.sign(user.id, session.id),
      refreshToken,
      expiresAt: session.expires_at,
    };
  }

  return {
    async register(input) {
      const passwordHash = await hashPassword(input.password);

      try {
        return await transaction(async (transactionRepository) => {
          const user = await transactionRepository.createUser({ ...input, passwordHash });

          await transactionRepository.audit(user.id, 'AUTH_REGISTERED', 'user', user.id);

          return issueSession(transactionRepository, user);
        });
      } catch (error) {
        if (error.code === '23505') {
          throw new AppError(409, 'ACCOUNT_EXISTS', 'Email или имя пользователя уже заняты');
        }

        throw error;
      }
    },

    async login({ email, password }) {
      const user = await repository.findByEmail(email);
      const matches = await verifyPassword(user?.password_hash ?? dummyHash, password);

      if (!user || !matches) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
      }

      if (isAccountBlocked(user)) {
        throw blocked();
      }

      return transaction(async (transactionRepository) => {
        const current = await transactionRepository.lockForLogin(user.id);

        if (
          !current ||
          current.email.toLowerCase() !== email.toLowerCase() ||
          (current.password_hash !== user.password_hash &&
            !(await verifyPassword(current.password_hash, password)))
        ) {
          throw new AppError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
        }

        if (isAccountBlocked(current)) {
          throw blocked();
        }

        const result = await issueSession(transactionRepository, current);

        await transactionRepository.audit(current.id, 'AUTH_LOGIN', 'user', current.id);

        return result;
      });
    },

    async refresh(token) {
      if (!isRefreshToken(token)) {
        throw unauthorized();
      }

      const digest = hashRefreshToken(token);

      const result = await transaction(async (transactionRepository) => {
        const user = await transactionRepository.findRefreshForUpdate(digest);

        if (!user || user.revoked_at || new Date(user.expires_at).getTime() <= Date.now()) {
          return { error: unauthorized() };
        }

        if (user.consumed_at || isAccountBlocked(user)) {
          await transactionRepository.revokeSession(user.session_id);
          await transactionRepository.audit(
            user.id,
            user.consumed_at ? 'AUTH_REFRESH_REPLAY' : 'AUTH_SESSION_REVOKED',
            'user',
            user.id,
          );

          return { error: isAccountBlocked(user) ? blocked() : unauthorized() };
        }

        await transactionRepository.touchPresence(user.id);

        const refreshToken = newRefreshToken();

        await transactionRepository.consumeRefreshToken(digest);
        await transactionRepository.addRefreshToken(
          user.session_id,
          hashRefreshToken(refreshToken),
        );
        await transactionRepository.audit(user.id, 'AUTH_REFRESHED', 'user', user.id);

        return {
          user: toPublicUser(user),
          accessToken: await accessTokens.sign(user.id, user.session_id),
          refreshToken,
          expiresAt: user.expires_at,
        };
      });
      // Throw only after the revocation transaction commits.
      if (result.error) {
        throw result.error;
      }

      return result;
    },

    async authenticate(token) {
      let identity;

      try {
        identity = await accessTokens.verify(token);
      } catch {
        throw unauthorized();
      }

      const user = await repository.findCurrentUser(identity.sessionId, identity.userId);

      if (!user) {
        throw unauthorized();
      }

      if (isAccountBlocked(user)) {
        throw blocked();
      }

      await repository.touchPresence(user.id);

      return toPublicUser(user);
    },

    async logout(token) {
      if (isRefreshToken(token)) {
        await transaction(async (transactionRepository) => {
          const user = await transactionRepository.findRefreshForUpdate(hashRefreshToken(token));

          if (user && !user.revoked_at) {
            await transactionRepository.revokeSession(user.session_id);
            await transactionRepository.audit(user.id, 'AUTH_LOGOUT', 'user', user.id);
          }
        });
      }
    },
  };
}
