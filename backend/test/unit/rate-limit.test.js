import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import { startApp } from '../helpers/http.js';
import { createRateLimit } from '../../src/utils/rate-limit.js';

test('rate limits reject excess requests with the API error format and modern retry headers', async (context) => {
  const router = Router();
  let calls = 0;

  router.post('/limited', createRateLimit(2, 2), (_request, response) => {
    calls++;
    response.status(204).end();
  });

  const app = await startApp(context, router);

  assert.equal((await app.request('/api/limited', { method: 'POST' })).response.status, 204);
  assert.equal((await app.request('/api/limited', { method: 'POST' })).response.status, 204);

  const blocked = await app.request('/api/limited', { method: 'POST' });

  assert.equal(blocked.response.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.equal(blocked.body.error.message, 'Слишком много запросов. Повторите позже');
  assert.equal(calls, 2);
  assert(blocked.response.headers.has('ratelimit'));
  assert(blocked.response.headers.has('ratelimit-policy'));
  assert.equal(blocked.response.headers.get('x-ratelimit-limit'), null);

  const retryAfter = Number(blocked.response.headers.get('retry-after'));

  assert(retryAfter > 60 && retryAfter <= 120);
});

test('separately created rate limiters keep independent counters for the same client', async (context) => {
  const router = Router();
  const respond = (_request, response) => response.status(204).end();

  router.post('/first', createRateLimit(15, 1), respond);
  router.post('/second', createRateLimit(15, 1), respond);

  const app = await startApp(context, router);

  assert.equal((await app.request('/api/first', { method: 'POST' })).response.status, 204);
  assert.equal((await app.request('/api/first', { method: 'POST' })).response.status, 429);
  assert.equal((await app.request('/api/second', { method: 'POST' })).response.status, 204);
  assert.equal((await app.request('/api/second', { method: 'POST' })).response.status, 429);
});
