import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const container = `workify-db-test-${randomUUID().slice(0, 8)}`;
const image = process.env.WORKIFY_TEST_POSTGRES_IMAGE || 'postgres:17-alpine';
let containerId;

async function docker(...args) {
  return exec('docker', args, { cwd: root, windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
}

async function psql(args, database = 'workify') {
  return docker('exec', container, 'psql', '-h', '127.0.0.1', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', database, ...args);
}

async function query(sql, database) {
  return (await psql(['-At', '-c', sql], database)).stdout.trim();
}

async function migrate(database) {
  await psql(['-f', '/tmp/database/migrate.sql'], database);
}

async function testMigrationRecovery() {
  await query('CREATE DATABASE workify_failed_migration');
  await docker('exec', container, 'cp', '-R', '/tmp/database', '/tmp/database-broken');
  // Corrupt only a disposable container copy, never a tracked migration.
  await docker('exec', container, 'sh', '-c',
    "printf '\nSELECT 1 / 0;\n' >> /tmp/database-broken/migrations/002_indexes_and_views.sql");
  await assert.rejects(
    psql(['-f', '/tmp/database-broken/migrate.sql'], 'workify_failed_migration'),
    error => /22012/.test(error.stderr),
    'An invalid migration must fail instead of recording its version',
  );
  assert.equal(await query('SELECT string_agg(version::text, \',\' ORDER BY version) FROM workify.schema_migrations',
    'workify_failed_migration'), '1');
  assert.equal(await query("SELECT count(*) FROM information_schema.views WHERE table_schema = 'workify'",
    'workify_failed_migration'), '0');
  assert.equal(await query('SELECT count(*) FROM workify.categories', 'workify_failed_migration'), '0');
  await migrate('workify_failed_migration');
  assert.equal(await query('SELECT count(*) FROM workify.schema_migrations', 'workify_failed_migration'), '3');
  console.log('PASS: failed migration rolls back its DDL and ledger; corrected migration resumes');
}

async function testConcurrentOrders() {
  const ids = Object.fromEntries(['customer', 'freelancer', 'other', 'project', 'proposal', 'invitation']
    .map(name => [name, randomUUID()]));
  const suffix = randomUUID().slice(0, 8);
  await query(`
    INSERT INTO workify.users (id, email, username, password_hash) VALUES
      ('${ids.customer}', 'race-customer-${suffix}@example.invalid', 'race_customer_${suffix}', 'test-only-hash'),
      ('${ids.freelancer}', 'race-freelancer-${suffix}@example.invalid', 'race_freelancer_${suffix}', 'test-only-hash'),
      ('${ids.other}', 'race-other-${suffix}@example.invalid', 'race_other_${suffix}', 'test-only-hash');
    INSERT INTO workify.projects (id, customer_id, category_id, title, description, status, published_at)
      SELECT '${ids.project}', '${ids.customer}', id, 'Конкурентный проект', 'Условия', 'OPEN', now()
      FROM workify.categories WHERE slug = 'web-development';
    INSERT INTO workify.proposals (id, project_id, customer_id, freelancer_id, message, offered_deadline_at, status, decided_at)
      VALUES ('${ids.proposal}', '${ids.project}', '${ids.customer}', '${ids.freelancer}', 'Отклик', now() + interval '7 days', 'ACCEPTED', now());
    INSERT INTO workify.project_invitations (id, project_id, customer_id, freelancer_id, message, offered_deadline_at, status, decided_at)
      VALUES ('${ids.invitation}', '${ids.project}', '${ids.customer}', '${ids.other}', 'Приглашение', now() + interval '7 days', 'ACCEPTED', now());
  `);
  const insert = kind => {
    const freelancer = kind === 'proposal' ? ids.freelancer : ids.other;
    return `INSERT INTO workify.orders (project_id, customer_id, freelancer_id, ${kind}_id,
      title_snapshot, description_snapshot, initial_deadline_at, deadline_at)
      VALUES ('${ids.project}', '${ids.customer}', '${freelancer}', '${ids[kind]}',
      'Снимок', 'Условия', now() + interval '7 days', now() + interval '7 days');`;
  };
  const attempt = kind => query(`BEGIN; ${insert(kind)} SELECT pg_sleep(1);
    UPDATE workify.projects SET status = 'IN_PROGRESS' WHERE id = '${ids.project}'; COMMIT;`);
  const results = await Promise.allSettled([attempt('proposal'), attempt('invitation')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'Exactly one concurrent insert succeeds');
  const failure = results.find(result => result.status === 'rejected');
  assert.match(failure.reason.stderr, /23505/);
  assert.match(failure.reason.stderr, /orders_one_active_per_project_uq/);
  assert.equal(await query(`SELECT count(*) FROM workify.orders WHERE project_id = '${ids.project}'`), '1');
  const fromProposal = await query(`SELECT proposal_id IS NOT NULL FROM workify.orders WHERE project_id = '${ids.project}'`);
  const unusedKind = fromProposal === 't' ? 'invitation' : 'proposal';
  await query(`BEGIN;
    UPDATE workify.orders SET status = 'CANCELLED', cancelled_by = '${ids.customer}', cancelled_at = now(),
      cancellation_reason = 'Повторное назначение' WHERE project_id = '${ids.project}';
    UPDATE workify.projects SET status = 'OPEN' WHERE id = '${ids.project}';
    ${insert(unusedKind)}
    UPDATE workify.projects SET status = 'IN_PROGRESS' WHERE id = '${ids.project}'; COMMIT;`);
  assert.equal(await query(`SELECT count(*) || ':' || count(*) FILTER (WHERE status = 'CANCELLED') || ':' ||
    count(*) FILTER (WHERE status IN ('IN_PROGRESS','SUBMITTED','REVISION_REQUESTED'))
    FROM workify.orders WHERE project_id = '${ids.project}'`), '2:1:1');
  console.log('PASS: concurrent proposal/invitation orders have one winner; cancellation preserves history and allows a new order');
}

try {
  await docker('version', '--format', '{{.Server.Version}}');
  console.log(`Starting disposable PostgreSQL: ${image} (no published ports, no host data mounts)`);
  containerId = (await docker('run', '--detach', '--name', container, '--label', 'workify.purpose=database-tests',
    '--network', 'none', '--tmpfs', '/var/lib/postgresql/data:rw,size=256m',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=workify', image)).stdout.trim();
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      // The image's temporary bootstrap server accepts only Unix-socket connections.
      await docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'workify');
      ready = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert(ready, 'Temporary PostgreSQL did not become ready');
  assert.equal(await query("SELECT current_setting('server_version_num')::integer / 10000"), '17');
  console.log(`PostgreSQL ${await query("SELECT current_setting('server_version')")}`);
  await docker('cp', 'database', `${container}:/tmp/database`);
  await migrate();
  const ledger = await query('SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM workify.schema_migrations m');
  await migrate();
  assert.equal(await query('SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM workify.schema_migrations m'), ledger);
  assert.equal(await query('SELECT count(*) FROM workify.schema_migrations'), '3');
  assert.equal(await query("SELECT count(*) FROM information_schema.tables WHERE table_schema='workify' AND table_type='BASE TABLE'"), '30');
  console.log('PASS: clean install and repeated migration run (27 domain tables + 2 auth tables + migration ledger)');
  for (const file of ['constraints.sql', 'views_and_seed.sql']) {
    const result = await psql(['-f', `/tmp/database/tests/${file}`]);
    console.log(result.stdout.trim());
  }
  await testMigrationRecovery();
  await testConcurrentOrders();
  console.log('All database checks passed.');
} catch (error) {
  console.error(error.stderr || error.stack || String(error));
  process.exitCode = 1;
} finally {
  if (containerId) {
    try {
      const label = (await docker('inspect', '--format', '{{index .Config.Labels "workify.purpose"}}', containerId)).stdout.trim();
      assert.equal(label, 'database-tests', 'Refusing to remove an unrelated container');
      await docker('rm', '--force', containerId);
      console.log('Disposable test container removed.');
    } catch (error) {
      console.error(`Test container cleanup failed (${container}): ${error.stderr || error.message}`);
      process.exitCode = 1;
    }
  }
}
