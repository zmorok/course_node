import { createAuditRepository } from './audit.repository.js';
import { databaseNow, lockRows, userInclude } from './database-tools.js';

const publicUser = (row) => (row?.profile ? { ...row, ...row.profile, id: row.id } : undefined);

export function createAuthRepository(database) {
  return {
    audit: createAuditRepository(database).audit,

    // метод обновления времени присутствия пользователя не чаще одного раза в минуту
    async touchPresence(id) {
      const now = await databaseNow(database);

      await database.users.updateMany({
        where: {
          id,
          OR: [
            { last_online_at: null },
            { last_online_at: { lt: new Date(now.getTime() - 60000) } },
          ],
        },
        data: { last_online_at: now },
      });
    },

    // метод получения аккаунта с профилем по email без учёта регистра
    async findByEmail(email) {
      return publicUser(
        await database.users.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          include: { profile: true },
        }),
      );
    },

    // метод блокировки аккаунта и повторного чтения данных для входа
    async lockForLogin(id) {
      await lockRows(database, 'users', [id]);

      return publicUser(
        await database.users.findUnique({ where: { id }, include: { profile: true } }),
      );
    },

    // метод назначения роли администратора существующему аккаунту по email
    async promoteToAdmin(email) {
      return (
        await database.users.updateManyAndReturn({
          where: { email: { equals: email, mode: 'insensitive' } },
          data: { role: 'ADMIN' },
          select: { id: true },
        })
      )[0];
    },

    // метод создания аккаунта клиента с переданным хешем пароля и отдельной записью профиля
    async createUser({ email, username, passwordHash, firstName, lastName }) {
      const user = await database.users.create({
        data: { email, username, password_hash: passwordHash, role: 'CLIENT' },
      });

      await database.profiles.create({
        data: { user_id: user.id, first_name: firstName, last_name: lastName },
      });

      return publicUser(
        await database.users.findUnique({ where: { id: user.id }, include: { profile: true } }),
      );
    },

    // метод создания сессии и сохранения хеша первого токена обновления
    async createSession(userId, expiresAt, tokenHash) {
      const session = await database.auth_sessions.create({
        data: { user_id: userId, expires_at: expiresAt },
      });

      await this.addRefreshToken(session.id, tokenHash);

      return session;
    },

    // метод добавления хеша токена обновления к существующей сессии
    async addRefreshToken(sessionId, tokenHash) {
      await database.auth_refresh_tokens.create({
        data: { session_id: sessionId, token_hash: tokenHash },
      });
    },

    // метод блокировки аккаунта и сессии с повторным чтением состояния токена
    async findRefreshForUpdate(tokenHash) {
      const token = await database.auth_refresh_tokens.findUnique({
        where: { token_hash: tokenHash },
        include: { session: true },
      });

      if (!token) return undefined;

      await lockRows(database, 'users', [token.session.user_id]);
      await lockRows(database, 'auth_sessions', [token.session_id]);

      const current = await database.auth_refresh_tokens.findUnique({
        where: { token_hash: tokenHash },
        include: { session: { include: { user: userInclude } } },
      });
      const user = publicUser(current?.session.user);

      return user
        ? {
            ...user,
            session_id: current.session_id,
            expires_at: current.session.expires_at,
            revoked_at: current.session.revoked_at,
            consumed_at: current.consumed_at,
          }
        : undefined;
    },

    // метод отметки токена обновления как использованного
    async consumeRefreshToken(tokenHash) {
      await database.auth_refresh_tokens.update({
        where: { token_hash: tokenHash },
        data: { consumed_at: await databaseNow(database) },
      });
    },

    // метод отзыва сессии с сохранением даты её первого отзыва
    async revokeSession(id) {
      await database.auth_sessions.updateMany({
        where: { id, revoked_at: null },
        data: { revoked_at: await databaseNow(database) },
      });
    },

    // метод поиска сессии по хешу токена обновления и её отзыва
    async revokeByRefreshToken(tokenHash) {
      const token = await database.auth_refresh_tokens.findUnique({
        where: { token_hash: tokenHash },
      });

      if (token) await this.revokeSession(token.session_id);
    },

    // метод получения пользователя по действующей сессии и идентификатору аккаунта
    async findCurrentUser(sessionId, userId) {
      const session = await database.auth_sessions.findFirst({
        where: {
          id: sessionId,
          user_id: userId,
          revoked_at: null,
          expires_at: { gt: await databaseNow(database) },
        },
        include: { user: userInclude },
      });

      return publicUser(session?.user);
    },
  };
}
