import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { profilePatch, profileParams, userSkillsInput } from '../../src/validators/profile.js';
import { ValidationError } from '../../src/utils/app-error.js';

test('profile patch normalizes only submitted fields and keeps password whitespace', () => {
  const input = { firstName: '  Анна  ', city: ' ', phone: null, description: ' Текст\nВторая строка ', currentPassword: ' password with spaces ' };
  assert.deepEqual({ ...profilePatch(input) }, { firstName: 'Анна', city: null, phone: null, description: 'Текст\nВторая строка', currentPassword: input.currentPassword });
  assert.equal(input.firstName, '  Анна  ');
  assert(!Object.hasOwn(profilePatch({ headline: '' }), 'lastName'));
});

test('profile rejects identity ownership privilege block password-hash and rating fields', () => {
  for (const key of ['id', 'userId', 'user_id', 'role', 'status', 'blocked_by', 'blockedUntil', 'password', 'password_hash', 'customerRating', 'skills', 'createdAt']) {
    assert.throws(() => profilePatch({ firstName: 'Имя', [key]: 'untrusted-value' }), ValidationError);
  }
});

test('profile rejects empty commands invalid data limits and control characters', () => {
  for (const value of [{}, { currentPassword: 'password-only' }, { firstName: '' }, { lastName: null },
    { firstName: 'x'.repeat(101) }, { headline: 'x'.repeat(201) }, { description: 'x'.repeat(5001) },
    { description: 'text\0private' }, { city: 'city\nother' }, { phone: 'call me' }, { phone: 123 },
    { email: 'invalid' }, { email: 'a\0b@example.invalid' }, { username: 'bad name' }, { username: 'ab' }]) {
    assert.throws(() => profilePatch(value), ValidationError);
  }
});

test('public profile route validates a UUID independently from request body', () => {
  const id = randomUUID();
  assert.equal(profileParams({ userId: id.toUpperCase() }).userId, id);
  assert.throws(() => profileParams({ userId: 'not-a-uuid' }), ValidationError);
});

test('skills replacement accepts an empty selection and normalizes a unique list', () => {
  assert.deepEqual(userSkillsInput({ skillIds: [] }).skillIds, []);
  const ids = [randomUUID(), randomUUID()];
  assert.deepEqual(userSkillsInput({ skillIds: ids.map(id => id.toUpperCase()) }).skillIds, ids);
});

test('skills reject duplicates invalid identifiers excessive counts and extra fields', () => {
  const id = randomUUID();
  for (const input of [{}, { skillIds: null }, { skillIds: 'react' }, { skillIds: ['react'] },
    { skillIds: [id, id.toUpperCase()] }, { skillIds: Array.from({ length: 51 }, () => randomUUID()) },
    { skillIds: [], userId: id }]) assert.throws(() => userSkillsInput(input), ValidationError);
});
