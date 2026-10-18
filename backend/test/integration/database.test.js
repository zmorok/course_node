import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config/env.js';
import { createDatabasePool } from '../../src/config/database.js';
import { createHealthRepository } from '../../src/repositories/health.repository.js';
import { withTransaction } from '../../src/repositories/transaction.js';

if (process.env.WORKIFY_DB_TESTS !== '1') throw new Error('Run integration tests through scripts/test-infrastructure.mjs in its disposable database');
const config = loadConfig({ ...process.env, NODE_ENV: 'test', PGPOOL_MAX: '2' });
const pool = createDatabasePool(config.database);
const ownedIds = [];
after(async () => {
  try {
    if (ownedIds.length) await pool.query('DELETE FROM workify.categories WHERE id = ANY($1::uuid[])', [ownedIds]);
  } finally {
    await pool.end();
  }
});

test('repository connects to real PostgreSQL 17 through the configured pool', async () => {
  assert.equal(await createHealthRepository(pool).ping(), true);
  const result = await pool.query("SELECT current_setting('server_version_num')::int / 10000 AS major");
  assert.equal(result.rows[0].major, 17);
});

test('transaction uses one session, commits parameterized data and does not execute submitted SQL text', async () => {
  const id = randomUUID();
  ownedIds.push(id);
  const hostileText = "Тест'); DROP TABLE workify.categories; --";
  await withTransaction(pool, async client => {
    const before = await client.query('SELECT pg_backend_pid() AS pid');
    await client.query('INSERT INTO workify.categories (id, slug, name) VALUES ($1, $2, $3)', [id, `test-${id}`, hostileText]);
    const after = await client.query('SELECT pg_backend_pid() AS pid');
    assert.equal(before.rows[0].pid, after.rows[0].pid);
  });
  const result = await pool.query('SELECT name FROM workify.categories WHERE id = $1', [id]);
  assert.equal(result.rows[0].name, hostileText);
});

test('an operation failure rolls back its inserts on real PostgreSQL', async () => {
  const id = randomUUID();
  ownedIds.push(id);
  const failure = new Error('expected rollback');
  await assert.rejects(withTransaction(pool, async client => {
    await client.query('INSERT INTO workify.categories (id, slug, name) VALUES ($1, $2, $3)', [id, `test-${id}`, 'Откат']);
    throw failure;
  }), error => error === failure);
  assert.equal((await pool.query('SELECT id FROM workify.categories WHERE id = $1', [id])).rowCount, 0);
});

test('a SQL constraint violation is rolled back and the pooled connection remains usable', async () => {
  await assert.rejects(withTransaction(pool, client => client.query(
    'INSERT INTO workify.categories (slug, name) VALUES ($1, $2)', ['web-development', 'Duplicate'],
  )), { code: '23505' });
  assert.equal(await createHealthRepository(pool).ping(), true);
});
