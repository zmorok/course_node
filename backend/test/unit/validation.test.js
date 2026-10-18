import test from 'node:test';
import assert from 'node:assert/strict';
import { object } from '../../src/validators/object.js';
import { text, integer, uuid, oneOf, optional } from '../../src/validators/fields.js';
import { ValidationError } from '../../src/utils/app-error.js';

test('schema returns only validated fields and explicitly coerces query integers', () => {
  const parse = object({ title: text({ max: 20 }), page: optional(integer({ min: 1, max: 100, coerce: true }), 1), note: optional(text()) });
  const input = { title: '  Задача  ', page: '2' };
  assert.deepEqual({ ...parse(input) }, { title: 'Задача', page: 2 });
  assert.deepEqual(input, { title: '  Задача  ', page: '2' });
  assert.equal(parse({ title: 'Задача' }).page, 1);
});

test('validation collects issues, rejects unlisted fields and does not echo submitted values', () => {
  const parse = object({ title: text({ min: 3 }), count: integer({ min: 1 }) });
  assert.throws(() => parse({ title: '', count: 0, role: 'private-secret-value' }), error => {
    assert(error instanceof ValidationError);
    assert.deepEqual(error.details.map(issue => issue.field).sort(), ['body.count', 'body.role', 'body.title']);
    assert(!JSON.stringify(error).includes('private-secret-value'));
    return true;
  });
});

test('object validation rejects null arrays exotic objects and prototype keys', () => {
  const parse = object({ title: text() });
  for (const value of [null, [], 'text', new Date(), Object.create({ title: 'inherited' }), JSON.parse('{"title":"ok","__proto__":{"polluted":true}}')]) {
    assert.throws(() => parse(value), ValidationError);
  }
  assert.equal({}.polluted, undefined);
  const fromQuery = Object.assign(Object.create(null), { title: 'valid' });
  assert.equal(parse(fromQuery).title, 'valid');
});

test('uuid, enum, integer and non-trimmed strings enforce their declared types', () => {
  const parse = object({ id: uuid(), mode: oneOf(['customer', 'freelancer']), count: integer(), token: text({ trim: false }), label: text({ pattern: /^ok$/g }) });
  const value = { id: 'A7FE633C-EC33-46C0-A97A-53D762491A09', mode: 'customer', count: 2, token: ' padded ', label: 'ok' };
  assert.equal(parse(value).id, value.id.toLowerCase());
  assert.equal(parse(value).token, value.token);
  assert.equal(parse(value).label, 'ok');
  assert.equal(parse(value).label, 'ok', 'Stateful regex flags must not affect later requests');
  for (const [field, bad] of [['id', 'not-uuid'], ['mode', 'admin'], ['count', '2'], ['count', 1.5], ['count', Infinity], ['label', 'bad']]) {
    assert.throws(() => parse({ ...value, [field]: bad }), ValidationError);
  }
});
