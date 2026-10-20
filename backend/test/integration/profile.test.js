import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config/env.js';
import { createDatabasePool } from '../../src/config/database.js';
import { createAuthRepository } from '../../src/repositories/auth.repository.js';
import { createProfileRepository } from '../../src/repositories/profile.repository.js';
import { withTransaction } from '../../src/repositories/transaction.js';
import { createAuthService } from '../../src/services/auth.service.js';
import { createProfileService } from '../../src/services/profile.service.js';
import { createAccessTokens } from '../../src/utils/tokens.js';
import { createApiRouter } from '../../src/routes/index.js';
import { startApp } from '../helpers/http.js';

if (process.env.WORKIFY_DB_TESTS !== '1') throw new Error('Use the disposable database in scripts/test-infrastructure.mjs');
const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
const pool = createDatabasePool(config.database), owned = [];
// Immutable audit keeps its actors until the disposable database is removed.
after(()=>pool.end());
const requestOptions = (token, method = 'GET', body) => ({ method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', 'X-Workify-Client': 'browser' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function setup(context) {
  const authService = await createAuthService({ repository: createAuthRepository(pool),
    transaction: operation => withTransaction(pool, client => operation(createAuthRepository(client))),
    accessTokens: createAccessTokens(config.auth), sessionTtlDays: config.auth.sessionTtlDays });
  const profileService = createProfileService({ repository: createProfileRepository(pool),
    transaction: operation => withTransaction(pool, client => operation(createProfileRepository(client))) });
  const app = await startApp(context, createApiRouter({ authService, authConfig: config.auth, profileService,
    healthService: { check: async () => ({ status: 'ok' }) } }));
  async function register() {
    const suffix = randomUUID().replaceAll('-', '');
    const input = { email: `${suffix}@example.invalid`, username: `p_${suffix}`, firstName: 'Анна', lastName: 'Тестова', password: 'profile test password ' };
    const result = await app.request('/api/auth/register', requestOptions(null, 'POST', input));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    owned.push(result.body.user.id);
    return { input, id: result.body.user.id, token: result.body.accessToken, cookie: result.response.headers.get('set-cookie').split(';')[0] };
  }
  return { ...app, register, get: token => app.request('/api/me/profile', requestOptions(token)),
    patch: (token, body) => app.request('/api/me/profile', requestOptions(token, 'PATCH', body)),
    skills: (token, ids) => app.request('/api/me/skills', requestOptions(token, 'PUT', { skillIds: ids })) };
}

test('skill catalog is public but own profile and mutations require authentication', async context => {
  const app = await setup(context), result = await app.request('/api/skills');
  assert.equal(result.response.status, 200); assert.equal(result.body.skills.length, 20);
  assert.deepEqual(Object.keys(result.body.skills[0]).sort(), ['id', 'name', 'slug']);
  for (const result of [await app.get(), await app.patch(null, { firstName: 'X' }), await app.skills(null, [])]) assert.equal(result.response.status, 401);
});

test('profile reads and partial updates persist normalized parameterized text without resetting other fields', async context => {
  const app = await setup(context), account = await app.register();
  const before = (await app.get(account.token)).body.profile;
  assert.equal(before.email, account.input.email); assert.deepEqual(before.skills, []);
  const description = "Текст'); DROP TABLE workify.profiles; --\n<script>example</script>";
  const saved = await app.patch(account.token, { firstName: '  Мария  ', headline: 'React-разработчик', description, phone: '+375 (29) 123-45-67', city: ' Минск ', country: 'Беларусь' });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const profile = (await app.get(account.token)).body.profile;
  assert.equal(profile.firstName, 'Мария'); assert.equal(profile.lastName, before.lastName);
  assert.equal(profile.city, 'Минск'); assert.equal(profile.description, description);
  assert.equal(profile.headline, 'React-разработчик'); assert.equal(profile.phone, '+375 (29) 123-45-67');
  assert.equal(profile.username, before.username);
  assert(!JSON.stringify(profile).includes('password_hash'));
});

test('optional fields can be cleared; invalid profile commands leave saved data intact', async context => {
  const app = await setup(context), account = await app.register();
  await app.patch(account.token, { phone: '+375291234567', city: 'Минск', country: 'Беларусь', headline: 'Текст' });
  const result = await app.patch(account.token, { phone: '', city: null, country: '', headline: '' });
  assert.equal(result.response.status, 200); assert.equal(result.body.profile.phone, null);
  assert.equal(result.body.profile.city, null); assert.equal(result.body.profile.country, null); assert.equal(result.body.profile.headline, '');
  const invalid = await app.patch(account.token, { firstName: 'Changed', description: 'x'.repeat(5001) });
  assert.equal(invalid.response.status, 422);
  assert.equal((await app.get(account.token)).body.profile.firstName, account.input.firstName);
});

test('ownership privilege status rating and password fields cannot be mass assigned', async context => {
  const app = await setup(context), account = await app.register(), other = await app.register();
  for (const key of ['id', 'userId', 'role', 'status', 'blocked_by', 'blockedUntil', 'password_hash', 'customerRating']) {
    const result = await app.patch(account.token, { firstName: 'Changed', [key]: other.id });
    assert.equal(result.response.status, 422, key);
  }
  assert.equal((await app.get(account.token)).body.profile.firstName, account.input.firstName);
  assert.equal((await app.get(other.token)).body.profile.firstName, other.input.firstName);
  assert.equal((await app.request(`/api/users/${other.id}`, requestOptions(account.token, 'PATCH', { firstName: 'Hacked' }))).response.status, 404);
  assert.equal((await app.request('/api/admin/access', requestOptions(account.token))).response.status, 403);
});

test('username and email uniqueness are case insensitive and conflicts roll back the whole profile edit', async context => {
  const app = await setup(context), account = await app.register(), other = await app.register();
  for (const body of [{ username: other.input.username.toUpperCase(), firstName: 'Changed' },
    { email: other.input.email.toUpperCase(), firstName: 'Changed', currentPassword: account.input.password }]) {
    const conflict = await app.patch(account.token, body);
    assert.equal(conflict.response.status, 409); assert.equal(conflict.body.error.code, 'PROFILE_CONFLICT');
    assert(!JSON.stringify(conflict.body).includes('constraint'));
  }
  const profile = (await app.get(account.token)).body.profile;
  assert.equal(profile.firstName, account.input.firstName); assert.equal(profile.email, account.input.email);
  assert.equal(profile.username, account.input.username);
});

test('changing email requires the current password and updates login and current-user data', async context => {
  const app = await setup(context), account = await app.register();
  const email = `${randomUUID()}@example.invalid`, username = `changed_${randomUUID().replaceAll('-', '')}`;
  assert.equal((await app.patch(account.token, { email, firstName: 'Changed' })).response.status, 422);
  assert.equal((await app.patch(account.token, { email, currentPassword: 'wrong-password', firstName: 'Changed' })).response.status, 403);
  assert.equal((await app.get(account.token)).body.profile.firstName, account.input.firstName);
  const saved = await app.patch(account.token, { email, username, currentPassword: account.input.password });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.profile.email, email); assert.equal(saved.body.profile.username, username);
  const me = await app.request('/api/auth/me', requestOptions(account.token));
  assert.equal(me.body.user.email, email); assert.equal(me.body.user.username, username);
  for (const [address, status] of [[account.input.email, 401], [email.toUpperCase(), 200]]) {
    const login = await app.request('/api/auth/login', requestOptions(null, 'POST', { email: address, password: account.input.password }));
    assert.equal(login.response.status, status);
  }
});

test('skills replace the whole saved set, persist on subsequent reads and support clearing', async context => {
  const app = await setup(context), account = await app.register();
  const catalog = (await app.request('/api/skills')).body.skills;
  const ids = catalog.slice(0, 3).map(skill => skill.id);
  const saved = await app.skills(account.token, ids);
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.deepEqual((await app.get(account.token)).body.profile.skills.map(skill => skill.id).sort(), [...ids].sort());
  assert.equal((await app.skills(account.token, ids.slice(0, 1))).body.profile.skills.length, 1);
  assert.equal((await app.skills(account.token, [])).body.profile.skills.length, 0);
  assert.deepEqual((await app.get(account.token)).body.profile.skills, []);
});

test('unknown duplicate malformed and oversized skill sets leave prior choices intact', async context => {
  const app = await setup(context), account = await app.register();
  const id = (await app.request('/api/skills')).body.skills[0].id;
  await app.skills(account.token, [id]);
  for (const ids of [[randomUUID()], [id, id], ['not-a-uuid'], Array.from({ length: 51 }, () => randomUUID())]) {
    assert.equal((await app.skills(account.token, ids)).response.status, 422);
    assert.deepEqual((await app.get(account.token)).body.profile.skills.map(skill => skill.id), [id]);
  }
});

test('concurrent skill replacements serialize and independent partial edits are preserved', async context => {
  const app = await setup(context), account = await app.register();
  const catalog = (await app.request('/api/skills')).body.skills;
  const first = catalog.slice(0, 2).map(skill => skill.id), second = catalog.slice(2, 4).map(skill => skill.id);
  const writes = await Promise.all([app.skills(account.token, first), app.skills(account.token, second)]);
  assert(writes.every(result => result.response.status === 200));
  const actual = (await app.get(account.token)).body.profile.skills.map(skill => skill.id).sort();
  assert([first, second].some(ids => JSON.stringify([...ids].sort()) === JSON.stringify(actual)));
  await Promise.all([app.patch(account.token, { firstName: 'Новое имя' }), app.patch(account.token, { city: 'Брест' })]);
  const profile = (await app.get(account.token)).body.profile;
  assert.equal(profile.firstName, 'Новое имя'); assert.equal(profile.city, 'Брест');
});

test('public profile includes skills and ratings but excludes contacts credentials and internal fields', async context => {
  const app = await setup(context), account = await app.register();
  await app.patch(account.token, { phone: '+375291234567', headline: 'Разработчик', city: 'Минск' });
  const id = (await app.request('/api/skills')).body.skills[0].id;
  await app.skills(account.token, [id]);
  const result = await app.request(`/api/users/${account.id}`);
  assert.equal(result.response.status, 200); assert.match(result.response.headers.get('cache-control'), /no-store/);
  assert.equal(result.body.profile.username, account.input.username); assert.equal(result.body.profile.skills[0].id, id);
  assert.equal(result.body.profile.customerRating, null); assert.equal(result.body.profile.customerReviewCount, 0);
  for (const key of ['email', 'phone', 'password_hash', 'role', 'status', 'blocked_by', 'block_reason']) assert(!Object.hasOwn(result.body.profile, key), key);
  assert(!JSON.stringify(result.body).includes(account.input.email));
  assert.equal((await app.request(`/api/users/${randomUUID()}`)).response.status, 404);
  assert.equal((await app.request('/api/users/not-a-uuid')).response.status, 422);
});

test('ADMIN can edit own personal data but has no freelancer skills or public client profile', async context => {
  const app = await setup(context), account = await app.register();
  await createAuthRepository(pool).promoteToAdmin(account.input.email);
  assert.equal((await app.patch(account.token, { firstName: 'Администратор' })).response.status, 200);
  assert.equal((await app.skills(account.token, [])).response.status, 403);
  assert.equal((await app.request(`/api/users/${account.id}`)).response.status, 404);
});

test('blocking and logout prevent profile mutations; expired temporary blocks become publicly visible', async context => {
  const app = await setup(context), account = await app.register();
  await pool.query("UPDATE workify.users SET status='BLOCKED', blocked_by=id, blocked_at=now(), block_reason='Profile test' WHERE id=$1", [account.id]);
  for (const result of [await app.get(account.token), await app.patch(account.token, { firstName: 'Changed' }), await app.skills(account.token, [])]) assert.equal(result.response.status, 403);
  assert.equal((await app.request(`/api/users/${account.id}`)).response.status, 404);
  await pool.query("UPDATE workify.users SET blocked_at=now()-interval '2 days', blocked_until=now()-interval '1 day' WHERE id=$1", [account.id]);
  assert.equal((await app.request(`/api/users/${account.id}`)).response.status, 200);
  const options = requestOptions(null, 'POST'); options.headers.Cookie = account.cookie;
  assert.equal((await app.request('/api/auth/logout', options)).response.status, 204);
  assert.equal((await app.patch(account.token, { firstName: 'Changed' })).response.status, 401);
});
