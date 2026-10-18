import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';
import { createAccessTokens, newRefreshToken, hashRefreshToken } from '../../src/utils/tokens.js';
import { registerInput } from '../../src/validators/auth.js';
import { ValidationError } from '../../src/utils/app-error.js';

test('Argon2id uses independent salts and preserves password whitespace', async () => {
  const password = '  strong password  ';
  const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);
  assert.match(first, /^\$argon2id\$v=19\$/);
  assert.deepEqual(Object.fromEntries(first.split('$')[3].split(',').map(part => part.split('='))), { m: '19456', t: '2', p: '1' });
  assert.notEqual(first, second);
  assert(await verifyPassword(first, password));
  assert.equal(await verifyPassword(first, password.trim()), false);
  assert(!first.includes(password));
});

test('JWT verification rejects expired tampered wrong-audience and wrong-algorithm tokens', async () => {
  const secret = randomBytes(32).toString('hex');
  const tokens = createAccessTokens({ secret, accessTtlSeconds: 900 });
  const userId = randomUUID(), sessionId = randomUUID();
  const token = await tokens.sign(userId, sessionId);
  assert.deepEqual(await tokens.verify(token), { userId, sessionId });
  await assert.rejects(tokens.verify(`${token.slice(0, -12)}untrustedsig`));
  const custom = (algorithm, audience, expiry) => new SignJWT({ sid: sessionId }).setProtectedHeader({ alg: algorithm, typ: 'JWT' })
    .setSubject(userId).setJti(randomUUID()).setIssuer('workify-api').setAudience(audience)
    .setIssuedAt().setExpirationTime(expiry).sign(Buffer.from(algorithm === 'HS256' ? secret : secret + secret, 'hex'));
  await assert.rejects(tokens.verify(await custom('HS256', 'workify-web', '0s')));
  await assert.rejects(tokens.verify(await custom('HS256', 'other-app', '15m')));
  await assert.rejects(tokens.verify(await custom('HS384', 'workify-web', '15m')));
});

test('refresh tokens have 256 bits of randomness and are stored as SHA-256 digests', () => {
  const token = newRefreshToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, newRefreshToken());
  assert.match(hashRefreshToken(token), /^[a-f0-9]{64}$/);
});

test('registration accepts only public account fields and enforces the password policy', () => {
  const input = { email: 'user@example.invalid', username: 'test_user', password: 'strong-password', firstName: 'Имя', lastName: 'Фамилия' };
  assert.equal(registerInput(input).username, input.username);
  for (const extra of [{ role: 'ADMIN' }, { status: 'ACTIVE' }, { id: randomUUID() }, { password: 'short' }, { username: 'CUSTOMER/FREELANCER' }]) {
    assert.throws(() => registerInput({ ...input, ...extra }), ValidationError);
  }
});
