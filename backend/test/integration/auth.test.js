import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config/env.js';
import { createDatabasePool } from '../../src/config/database.js';
import { createAuthRepository } from '../../src/repositories/auth.repository.js';
import { withTransaction } from '../../src/repositories/transaction.js';
import { createAuthService } from '../../src/services/auth.service.js';
import { createAccessTokens, hashRefreshToken } from '../../src/utils/tokens.js';
import { createApiRouter } from '../../src/routes/index.js';
import { startApp } from '../helpers/http.js';

if (process.env.WORKIFY_DB_TESTS !== '1') throw new Error('Use the disposable database in scripts/test-infrastructure.mjs');
const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
const pool = createDatabasePool(config.database);
const owned = [];
// Immutable audit keeps its actors until the disposable database is removed.
after(()=>pool.end());
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workify-Client': 'browser' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const bearer = token => ({ headers: { Authorization: `Bearer ${token}` } });
const cookieOf = result => result.response.headers.get('set-cookie')?.split(';')[0];
const withCookie = cookie => { const options = post(); options.headers.Cookie = cookie; return options; };
function newAccount() {
  const suffix = randomUUID().replaceAll('-', '');
  return { email: `${suffix}@example.invalid`, username: `auth_${suffix}`, password: 'test password with spaces ', firstName: 'Тест', lastName: 'Пользователь' };
}
async function setup(context) {
  const service = await createAuthService({ repository: createAuthRepository(pool),
    transaction: operation => withTransaction(pool, client => operation(createAuthRepository(client))),
    accessTokens: createAccessTokens(config.auth), sessionTtlDays: config.auth.sessionTtlDays });
  const healthService = { check: async () => ({ status: 'ok', checks: { database: 'up', uploads: 'up' } }) };
  const app = await startApp(context, createApiRouter({ healthService, authService: service, authConfig: { ...config.auth, cookieSecure: true } }));
  async function register(input = newAccount()) {
    const result = await app.request('/api/auth/register', post(input));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    owned.push(result.body.user.id);
    return { ...result, input, cookie: cookieOf(result), token: result.body.accessToken };
  }
  return { ...app, register };
}

test('registration persists Argon2id, CLIENT, profile and a hashed refresh credential atomically', async context => {
  const app = await setup(context), account = await app.register();
  assert.equal(account.body.user.role, 'CLIENT');
  assert.equal(account.body.user.firstName, 'Тест');
  assert(!JSON.stringify(account.body).includes('password'));
  assert.equal(account.body.refreshToken, undefined);
  const cookie = account.response.headers.get('set-cookie');
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/auth']) assert(cookie.includes(attribute));
  const row = (await pool.query(`SELECT password_hash, t.token_hash FROM workify.users u
    JOIN workify.auth_sessions s ON s.user_id=u.id JOIN workify.auth_refresh_tokens t ON t.session_id=s.id WHERE u.id=$1`, [account.body.user.id])).rows[0];
  assert.match(row.password_hash, /^\$argon2id\$/);
  assert.equal(row.token_hash, hashRefreshToken(account.cookie.split('=')[1]));
  assert.notEqual(row.password_hash, account.input.password);
  assert.equal((await app.request('/api/auth/me', bearer(account.token))).body.user.id, account.body.user.id);
});

test('duplicate email/username are case insensitive and invalid registration does not escalate roles', async context => {
  const app = await setup(context), account = await app.register();
  for (const input of [{ ...newAccount(), email: account.input.email.toUpperCase() }, { ...newAccount(), username: account.input.username.toUpperCase() }]) {
    assert.equal((await app.request('/api/auth/register', post(input))).response.status, 409);
  }
  const forbidden = newAccount();
  assert.equal((await app.request('/api/auth/register', post({ ...forbidden, role: 'ADMIN' }))).response.status, 422);
  assert.equal((await pool.query('SELECT id FROM workify.users WHERE email=$1', [forbidden.email])).rowCount, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM workify.profiles WHERE user_id=$1', [account.body.user.id])).rows[0].count, 1);
});

test('login verifies the untrimmed password, accepts email case and hides unknown-email differences', async context => {
  const app = await setup(context), account = await app.register();
  const unknown = await app.request('/api/auth/login', post({ email: 'absent@example.invalid', password: 'incorrect-password' }));
  const wrong = await app.request('/api/auth/login', post({ email: account.input.email, password: account.input.password.trim() }));
  assert.equal(wrong.response.status, 401);
  assert.deepEqual(wrong.body.error, unknown.body.error);
  const login = await app.request('/api/auth/login', post({ email: account.input.email.toUpperCase(), password: account.input.password }));
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.id, account.body.user.id);
});

test('anonymous and forged tokens have no access; role changes are effective for an already issued JWT', async context => {
  const app = await setup(context), account = await app.register();
  for (const path of ['/api/auth/me', '/api/admin/access']) {
    assert.equal((await app.request(path)).response.status, 401);
    assert.equal((await app.request(path, bearer('fake.jwt.token'))).response.status, 401);
  }
  assert.equal((await app.request('/api/admin/access', bearer(account.token))).response.status, 403);
  await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1", [account.body.user.id]);
  assert.equal((await app.request('/api/admin/access', bearer(account.token))).body.access, 'ADMIN');
  await pool.query("UPDATE workify.users SET role='CLIENT' WHERE id=$1", [account.body.user.id]);
  assert.equal((await app.request('/api/admin/access', bearer(account.token))).response.status, 403);
});

test('refresh rotates cookies and replay revokes the whole session including old and new access JWTs', async context => {
  const app = await setup(context), account = await app.register();
  const refreshed = await app.request('/api/auth/refresh', withCookie(account.cookie));
  assert.equal(refreshed.response.status, 200);
  assert.notEqual(cookieOf(refreshed), account.cookie);
  assert.equal((await app.request('/api/auth/me', bearer(refreshed.body.accessToken))).response.status, 200);
  assert.equal((await app.request('/api/auth/refresh', withCookie(account.cookie))).response.status, 401);
  assert.equal((await app.request('/api/auth/refresh', withCookie(cookieOf(refreshed)))).response.status, 401);
  for (const token of [account.token, refreshed.body.accessToken]) assert.equal((await app.request('/api/auth/me', bearer(token))).response.status, 401);
});

test('concurrent refresh with the same token has one winner and commits replay revocation', async context => {
  const app = await setup(context), account = await app.register();
  const results = await Promise.all([app.request('/api/auth/refresh', withCookie(account.cookie)), app.request('/api/auth/refresh', withCookie(account.cookie))]);
  assert.deepEqual(results.map(result => result.response.status).sort(), [200, 401]);
  const winner = results.find(result => result.response.status === 200);
  assert.equal((await app.request('/api/auth/me', bearer(winner.body.accessToken))).response.status, 401);
});

test('logout is idempotent, clears the cookie and immediately invalidates this session only', async context => {
  const app = await setup(context), account = await app.register();
  const other = await app.request('/api/auth/login', post({ email: account.input.email, password: account.input.password }));
  const out = await app.request('/api/auth/logout', withCookie(account.cookie));
  assert.equal(out.response.status, 204);
  assert.match(out.response.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await app.request('/api/auth/me', bearer(account.token))).response.status, 401);
  assert.equal((await app.request('/api/auth/refresh', withCookie(account.cookie))).response.status, 401);
  assert.equal((await app.request('/api/auth/me', bearer(other.body.accessToken))).response.status, 200);
  assert.equal((await app.request('/api/auth/logout', post())).response.status, 204);
});

test('blocking stops existing access, login and refresh; logout remains available', async context => {
  const app = await setup(context), account = await app.register();
  await pool.query("UPDATE workify.users SET status='BLOCKED', blocked_by=id, blocked_at=now(), block_reason='Test block' WHERE id=$1", [account.body.user.id]);
  const me = await app.request('/api/auth/me', bearer(account.token));
  assert.equal(me.response.status, 403); assert.equal(me.body.error.code, 'ACCOUNT_BLOCKED');
  assert.equal((await app.request('/api/auth/login', post({ email: account.input.email, password: account.input.password }))).response.status, 403);
  assert.equal((await app.request('/api/auth/refresh', withCookie(account.cookie))).response.status, 403);
  assert.equal((await app.request('/api/auth/logout', withCookie(account.cookie))).response.status, 204);
});

test('an expired temporary block no longer prevents ordinary access', async context => {
  const app = await setup(context), account = await app.register();
  await pool.query("UPDATE workify.users SET status='BLOCKED', blocked_by=id, blocked_at=now()-interval '2 days', blocked_until=now()-interval '1 day', block_reason='Expired test' WHERE id=$1", [account.body.user.id]);
  const me = await app.request('/api/auth/me', bearer(account.token));
  assert.equal(me.response.status, 200); assert.equal(me.body.user.status, 'ACTIVE');
});

test('session expiration is enforced even while its access JWT is valid', async context => {
  const app = await setup(context), account = await app.register();
  await pool.query("UPDATE workify.auth_sessions SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day' WHERE user_id=$1", [account.body.user.id]);
  assert.equal((await app.request('/api/auth/me', bearer(account.token))).response.status, 401);
  assert.equal((await app.request('/api/auth/refresh', withCookie(account.cookie))).response.status, 401);
});

test('cookie mutations require the client header, reject cross-site requests and rate-limit credentials', async context => {
  const app = await setup(context);
  assert.equal((await app.request('/api/auth/logout', { method: 'POST' })).response.status, 403);
  const crossSite = post(); crossSite.headers['Sec-Fetch-Site'] = 'cross-site';
  assert.equal((await app.request('/api/auth/refresh', crossSite)).response.status, 403);
  for (let i = 0; i < 20; i++) assert.equal((await app.request('/api/auth/login', post({}))).response.status, 422);
  const limited = await app.request('/api/auth/login', post({}));
  assert.equal(limited.response.status, 429); assert.equal(limited.body.error.code, 'RATE_LIMITED');
  assert(limited.response.headers.has('retry-after'));
});
