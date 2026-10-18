import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import { startApp } from '../helpers/http.js';
import { asyncHandler } from '../../src/utils/async-handler.js';
import { AppError } from '../../src/utils/app-error.js';
import { createErrorHandler } from '../../src/middleware/error-handler.js';
import { validate } from '../../src/middleware/validate.js';
import { object } from '../../src/validators/object.js';
import { text, integer } from '../../src/validators/fields.js';
import { createHealthService } from '../../src/services/health.service.js';
import { createApiRouter } from '../../src/routes/index.js';

function assertProblem(result, status, code) {
  assert.equal(result.response.status, status);
  assert.match(result.response.headers.get('content-type'), /application\/json/);
  assert.match(result.response.headers.get('cache-control'), /no-store/);
  assert.equal(result.body.error.code, code);
  assert(Array.isArray(result.body.error.details));
  assert.match(result.body.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(result.body.requestId, result.response.headers.get('x-request-id'));
}

test('404 is JSON and the server generates its own request ID', async context => {
  const app = await startApp(context, Router());
  const first = await app.request('/api/missing', { headers: { 'X-Request-Id': 'untrusted-client-id' } });
  assertProblem(first, 404, 'NOT_FOUND');
  const second = await app.request('/outside-api');
  assertProblem(second, 404, 'NOT_FOUND');
  assert.notEqual(first.body.requestId, second.body.requestId);
  assert.equal(first.response.headers.get('x-powered-by'), null);
});

test('async handler catches synchronous asynchronous and non-Error failures safely', async context => {
  const router = Router();
  router.get('/sync', asyncHandler(() => { throw new Error('secret-sync'); }));
  router.get('/async', asyncHandler(async () => { throw new Error('secret-async'); }));
  router.get('/non-error', asyncHandler(() => Promise.reject('route')));
  router.get('/false', asyncHandler(() => Promise.reject(false)));
  router.get('/operational', asyncHandler(() => { throw new AppError(403, 'FORBIDDEN', 'Доступ запрещён'); }));
  const app = await startApp(context, router);
  for (const path of ['sync', 'async', 'non-error', 'false']) {
    const result = await app.request(`/api/${path}?token=secret-query`);
    assertProblem(result, 500, 'INTERNAL_ERROR');
    assert(!JSON.stringify(result.body).includes('secret'));
  }
  assertProblem(await app.request('/api/operational'), 403, 'FORBIDDEN');
  assert.equal(app.logs.length, 4);
  assert(!app.logs.join('').includes('secret'));
});

test('parser failures and body size limits use the common envelope', async context => {
  const router = Router();
  router.post('/echo', (request, response) => response.json(request.body));
  const app = await startApp(context, router, { jsonLimitBytes: 1024 });
  const post = (body, contentType = 'application/json') => app.request('/api/echo', { method: 'POST', headers: { 'Content-Type': contentType }, body });
  const malformed = await post('{"password":"secret-body",');
  assertProblem(malformed, 400, 'INVALID_JSON');
  assert(!JSON.stringify(malformed.body).includes('secret-body'));
  assertProblem(await post(JSON.stringify({ text: 'x'.repeat(2000) })), 413, 'PAYLOAD_TOO_LARGE');
  assertProblem(await post('{}', 'application/json; charset=invalid-charset'), 415, 'UNSUPPORTED_ENCODING');
  assert.equal((await post('{"accepted":true}', 'application/vnd.workify+json')).body.accepted, true);
});

test('validation middleware validates body and read-only Express query separately', async context => {
  const router = Router();
  let handled = 0;
  router.post('/validate', validate(object({ title: text({ max: 30 }) })), (request, response) => {
    handled++;
    response.json(request.validated.body);
  });
  router.get('/query', validate(object({ page: integer({ min: 1, max: 100, coerce: true }) }, { field: 'query' }), 'query'), (request, response) => response.json(request.validated.query));
  router.get('/items/:id', (_request, response) => response.json({ ok: true }));
  const app = await startApp(context, router);
  const invalid = await app.request('/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":"ok","role":"ADMIN"}' });
  assertProblem(invalid, 422, 'VALIDATION_ERROR');
  assert.equal(handled, 0);
  const valid = await app.request('/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"title":"  Задача  "}' });
  assert.deepEqual(valid.body, { title: 'Задача' });
  assert.equal(handled, 1);
  assert.deepEqual((await app.request('/api/query?page=2')).body, { page: 2 });
  assertProblem(await app.request('/api/query?page=2&page=3'), 422, 'VALIDATION_ERROR');
  assertProblem(await app.request('/api/items/%E0%A4%A'), 400, 'INVALID_REQUEST');
});

test('database errors map to safe API errors without SQL or constraint details', async context => {
  const router = Router();
  router.get('/database/:code', asyncHandler(request => {
    throw Object.assign(new Error('private SQL and password'), { code: request.params.code, detail: 'private email', constraint: 'private_constraint' });
  }));
  const app = await startApp(context, router);
  for (const [code, status, publicCode] of [
    ['23505', 409, 'CONFLICT'], ['23503', 409, 'CONFLICT'], ['40001', 409, 'CONFLICT'], ['40P01', 409, 'CONFLICT'],
    ['23514', 422, 'VALIDATION_ERROR'], ['22P02', 422, 'VALIDATION_ERROR'],
    ['ECONNREFUSED', 503, 'SERVICE_UNAVAILABLE'], ['08006', 503, 'SERVICE_UNAVAILABLE'], ['57P01', 503, 'SERVICE_UNAVAILABLE'],
    ['unexpected', 500, 'INTERNAL_ERROR'],
  ]) {
    const result = await app.request(`/api/database/${code}`);
    assertProblem(result, status, publicCode);
    assert(!JSON.stringify(result.body).includes('private'));
  }
});

test('existing readiness contract reports independent database and uploads checks', async context => {
  let connected = true;
  let storageAvailable = true;
  const healthService = createHealthService({
    healthRepository: { ping: async () => connected }, uploadDir: '/unused',
    checkStorage: async () => { if (!storageAvailable) throw new Error('private storage path'); },
  });
  const app = await startApp(context, createApiRouter({ healthService }));
  assert.deepEqual((await app.request('/api/health')).body, { status: 'ok', checks: { database: 'up', uploads: 'up' } });
  connected = false;
  assert.equal((await app.request('/api/health')).response.status, 503);
  storageAvailable = false;
  assert.deepEqual((await app.request('/api/health')).body, { status: 'error', checks: { database: 'down', uploads: 'down' } });
});

test('error middleware delegates an error after response headers have been sent', () => {
  const error = new Error('failure after streaming started');
  let forwarded;
  createErrorHandler({ error() { assert.fail('Must not write another response'); } })(error, {}, { headersSent: true }, value => { forwarded = value; });
  assert.equal(forwarded, error);
});
