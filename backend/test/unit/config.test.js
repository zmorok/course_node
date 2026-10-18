import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigurationError } from '../../src/config/env.js';
import { createDatabasePool } from '../../src/config/database.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const valid = { NODE_ENV: 'test', PGPASSWORD: 'test-only-password' };

test('configuration preserves Docker defaults, secret whitespace and immutable options', () => {
  const config = loadConfig({ ...valid, PGPASSWORD: '  significant spaces  ' });
  assert.equal(config.port, 3000);
  assert.equal(config.database.host, 'postgres');
  assert.equal(config.database.port, 5432);
  assert.equal(config.database.password, '  significant spaces  ');
  assert.equal(config.database.max, 5);
  assert.equal(config.jsonLimitBytes, 65536);
  assert(Object.isFrozen(config));
  assert(Object.isFrozen(config.database));
});

test('invalid settings fail with field names and no configuration values', async context => {
  const cases = [
    ['PORT', '0'], ['PORT', '3000junk'], ['PORT', '65536'], ['PORT', '2e3'],
    ['PGPORT', '-1'], ['PGPOOL_MAX', '0'], ['PGPOOL_MAX', '51'],
    ['PG_CONNECTION_TIMEOUT_MS', '0'], ['HTTP_JSON_LIMIT_BYTES', '1048577'],
    ['PGHOST', ''], ['PGUSER', ' '], ['PGDATABASE', ''], ['PGPASSWORD', ''],
    ['NODE_ENV', 'unknown'], ['UPLOAD_DIR', 'relative/uploads'],
  ];
  for (const [field, value] of cases) {
    await context.test(`${field}: ${JSON.stringify(value)}`, () => {
      assert.throws(() => loadConfig({ ...valid, [field]: value }), error => {
        assert(error instanceof ConfigurationError);
        assert(error.fields.includes(field));
        assert(!error.message.includes(valid.PGPASSWORD));
        return true;
      });
    });
  }
});

test('pg pool is lazy, uses bounded timeouts and hides idle-connection error details', async () => {
  const logs = [];
  const config = loadConfig(valid);
  const pool = createDatabasePool(config.database, { error: message => logs.push(message) });
  assert.equal(pool.totalCount, 0);
  assert.equal(pool.options.connectionTimeoutMillis, 2000);
  assert.equal(pool.options.query_timeout, 2000);
  assert.equal(pool.options.statement_timeout, 2000);
  pool.emit('error', new Error('private credentials must stay private'));
  assert.equal(logs.length, 1);
  assert(!logs[0].includes('credentials'));
  await pool.end();
});

test('invalid startup exits before listening and does not print credentials', async () => {
  const execute = promisify(execFile);
  const secret = 'startup-secret-must-not-appear';
  await assert.rejects(execute(process.execPath, [fileURLToPath(new URL('../../src/server.js', import.meta.url))], {
    env: { ...process.env, PORT: 'invalid-port', PGPASSWORD: secret }, timeout: 5000,
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Invalid environment variables: PORT/);
    assert(!error.stderr.includes(secret));
    assert(!error.stdout.includes('listening'));
    return true;
  });
});
