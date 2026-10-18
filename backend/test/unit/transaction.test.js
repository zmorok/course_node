import test from 'node:test';
import assert from 'node:assert/strict';
import { withTransaction } from '../../src/repositories/transaction.js';

function fakePool({ failAt, failure = new Error('database failure') } = {}) {
  const calls = [];
  const releases = [];
  const client = {
    async query(sql) { calls.push(sql); if (sql === failAt) throw failure; },
    release(error) { releases.push(error); },
  };
  return { pool: { async connect() { return client; } }, client, calls, releases, failure };
}

test('transaction returns the operation result and releases the same client once', async () => {
  const fixture = fakePool();
  const result = await withTransaction(fixture.pool, async client => {
    assert.equal(client, fixture.client);
    await client.query('WRITE');
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(fixture.calls, ['BEGIN', 'WRITE', 'COMMIT']);
  assert.deepEqual(fixture.releases, [undefined]);
});

test('operation and commit errors roll back before releasing the client', async () => {
  for (const phase of ['operation', 'COMMIT']) {
    const fixture = fakePool({ failAt: phase });
    const failure = fixture.failure;
    await assert.rejects(withTransaction(fixture.pool, async () => { if (phase === 'operation') throw failure; }), error => error === failure);
    assert.deepEqual(fixture.calls, phase === 'operation' ? ['BEGIN', 'ROLLBACK'] : ['BEGIN', 'COMMIT', 'ROLLBACK']);
    assert.deepEqual(fixture.releases, [undefined]);
  }
});

test('failed BEGIN and failed rollback discard unusable clients without hiding the original error', async () => {
  const begin = fakePool({ failAt: 'BEGIN' });
  await assert.rejects(withTransaction(begin.pool, () => assert.fail('Must not enter operation')), error => error === begin.failure);
  assert.deepEqual(begin.calls, ['BEGIN']);
  assert.deepEqual(begin.releases, [begin.failure]);
  const rollback = fakePool({ failAt: 'ROLLBACK' });
  const original = new Error('original operation error');
  await assert.rejects(withTransaction(rollback.pool, () => { throw original; }), error => error === original);
  assert.deepEqual(rollback.releases, [rollback.failure]);
});

test('failed connect never enters an operation or releases a nonexistent client', async () => {
  const failure = new Error('connect failed');
  await assert.rejects(withTransaction({ connect: async () => { throw failure; } }, () => assert.fail()), error => error === failure);
});
