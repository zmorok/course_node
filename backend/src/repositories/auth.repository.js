import {createAuditRepository} from './audit.repository.js';
const publicColumns = `u.id, u.email, u.username, u.role, u.status, u.blocked_until,
  p.first_name, p.last_name`;

export function createAuthRepository(database) {
  return {
    audit:createAuditRepository(database).audit,
    async findByEmail(email) {
      const result = await database.query(`SELECT ${publicColumns}, u.password_hash
        FROM workify.users u JOIN workify.profiles p ON p.user_id = u.id
        WHERE lower(u.email) = lower($1)`, [email]);
      return result.rows[0];
    },
    async lockForLogin(id){return (await database.query(`SELECT ${publicColumns},u.password_hash FROM workify.users u JOIN workify.profiles p ON p.user_id=u.id WHERE u.id=$1 FOR UPDATE OF u`,[id])).rows[0];},
    async promoteToAdmin(email) {
      return (await database.query("UPDATE workify.users SET role = 'ADMIN' WHERE lower(email) = lower($1) RETURNING id", [email])).rows[0];
    },
    async createUser({ email, username, passwordHash, firstName, lastName }) {
      const result = await database.query(`INSERT INTO workify.users (email, username, password_hash, role)
        VALUES ($1, $2, $3, 'CLIENT') RETURNING id`, [email, username, passwordHash]);
      const id = result.rows[0].id;
      await database.query(`INSERT INTO workify.profiles (user_id, first_name, last_name) VALUES ($1, $2, $3)`, [id, firstName, lastName]);
      return (await database.query(`SELECT ${publicColumns} FROM workify.users u
        JOIN workify.profiles p ON p.user_id = u.id WHERE u.id = $1`, [id])).rows[0];
    },
    async createSession(userId, expiresAt, tokenHash) {
      const result = await database.query(`INSERT INTO workify.auth_sessions (user_id, expires_at)
        VALUES ($1, $2) RETURNING id, expires_at`, [userId, expiresAt]);
      const session = result.rows[0];
      await this.addRefreshToken(session.id, tokenHash);
      return session;
    },
    async addRefreshToken(sessionId, tokenHash) {
      await database.query(`INSERT INTO workify.auth_refresh_tokens (session_id, token_hash) VALUES ($1, $2)`, [sessionId, tokenHash]);
    },
    async findRefreshForUpdate(tokenHash) {
      // Match moderation/profile ordering: user, then session, then audit foreign keys.
      await database.query(`SELECT u.id FROM workify.users u JOIN workify.auth_sessions s ON s.user_id=u.id
        WHERE s.id=(SELECT session_id FROM workify.auth_refresh_tokens WHERE token_hash=$1) FOR UPDATE OF u`,[tokenHash]);
      // Serialize every rotation in a session, including replayed old tokens.
      const user = (await database.query(`SELECT ${publicColumns}, s.id AS session_id,
        s.expires_at, s.revoked_at FROM workify.auth_sessions s
        JOIN workify.users u ON u.id = s.user_id JOIN workify.profiles p ON p.user_id = u.id
        WHERE s.id = (SELECT session_id FROM workify.auth_refresh_tokens WHERE token_hash = $1)
        FOR UPDATE OF s`, [tokenHash])).rows[0];
      if (!user) return undefined;
      // A second statement sees committed consumption after waiting for the lock.
      const token = (await database.query('SELECT consumed_at FROM workify.auth_refresh_tokens WHERE token_hash = $1', [tokenHash])).rows[0];
      return { ...user, consumed_at: token.consumed_at };
    },
    async consumeRefreshToken(tokenHash) {
      await database.query('UPDATE workify.auth_refresh_tokens SET consumed_at = clock_timestamp() WHERE token_hash = $1', [tokenHash]);
    },
    async revokeSession(sessionId) {
      await database.query('UPDATE workify.auth_sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp()) WHERE id = $1', [sessionId]);
    },
    async revokeByRefreshToken(tokenHash) {
      await database.query(`UPDATE workify.auth_sessions SET revoked_at = COALESCE(revoked_at, clock_timestamp())
        WHERE id = (SELECT session_id FROM workify.auth_refresh_tokens WHERE token_hash = $1)`, [tokenHash]);
    },
    async findCurrentUser(sessionId, userId) {
      return (await database.query(`SELECT ${publicColumns} FROM workify.auth_sessions s
        JOIN workify.users u ON u.id = s.user_id JOIN workify.profiles p ON p.user_id = u.id
        WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`, [sessionId, userId])).rows[0];
    },
  };
}
