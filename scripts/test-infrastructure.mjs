import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const project = `workify-smoke-${randomUUID().slice(0, 8)}`;
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  POSTGRES_DB: 'workify_smoke',
  POSTGRES_USER: 'workify_smoke',
  POSTGRES_PASSWORD: randomBytes(32).toString('hex'),
  FRONTEND_PORT: '0',
  BACKEND_PORT: '0',
};
const prefix = ['compose', '--project-name', project, '--env-file', '.env.example', '--file', 'compose.yaml'];
let created = false;

async function docker(...args) {
  return exec('docker', args, { cwd: root, env: environment, windowsHide: true, timeout: 300_000, maxBuffer: 8 * 1024 * 1024 });
}

async function compose(...args) {
  return docker(...prefix, ...args);
}

async function sql(query) {
  return (await compose('exec', '-T', 'postgres', 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1',
    '-U', 'workify_smoke', '-d', 'workify_smoke', '-c', query)).stdout.trim();
}

async function backendNode(source) {
  return (await compose('exec', '-T', 'backend', 'node', '--input-type=module', '-e', source)).stdout.trim();
}

async function serviceUrl(service, port) {
  const address = (await compose('port', service, String(port))).stdout.trim();
  assert.match(address, /^127\.0\.0\.1:\d+$/, 'Test ports must bind to loopback only');
  return `http://${address}`;
}

async function request(url) {
  return fetch(url, { signal: AbortSignal.timeout(15000) });
}

async function expectHealth(base, expectedStatus, database) {
  const response = await request(`${base}/api/health`);
  assert.equal(response.status, expectedStatus);
  const body = await response.json();
  assert.equal(body.checks.database, database);
  assert.equal(body.checks.uploads, 'up');
  assert.equal(body.status, expectedStatus === 200 ? 'ok' : 'error');
  assert.match(response.headers.get('cache-control'), /no-store/);
}

try {
  console.log(`Checking Compose in an isolated project: ${project}`);
  await compose('config', '--quiet');
  created = true;
  await compose('up', '--build', '-d', '--wait', '--wait-timeout', '120');
  let frontend = await serviceUrl('frontend', 8080);
  let backend = await serviceUrl('backend', 3000);
  assert.equal(await backendNode('console.log(process.versions.node.split(".")[0])'), '24');
  assert.equal(await backendNode('console.log(process.getuid())'), '1000');
  assert.equal(await backendNode('console.log(process.env.PGHOST)'), 'postgres');
  assert.equal(await sql("SELECT current_setting('server_version_num')::int / 10000"), '17');
  assert.equal(await sql('SELECT count(*) FROM workify.schema_migrations'), '2');
  assert.equal(await sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='workify' AND table_type='BASE TABLE'"), '28');
  assert.equal(await sql('SELECT count(*) FROM workify.categories'), '8');
  assert.equal(await sql('SELECT count(*) FROM workify.skills'), '20');
  await expectHealth(backend, 200, 'up');
  await expectHealth(frontend, 200, 'up');
  const missing = await request(`${frontend}/api/missing`);
  assert.equal(missing.status, 404);
  const missingBody = await missing.json();
  assert.equal(missingBody.error.code, 'NOT_FOUND');
  assert.equal(missingBody.requestId, missing.headers.get('x-request-id'));

  for (const script of ['test', 'test:integration']) {
    const result = await compose('run', '--rm', '--no-deps', '--volume', './backend/test:/app/test:ro',
      '-e', 'WORKIFY_DB_TESTS=1', 'backend', 'npm', 'run', script);
    console.log(result.stdout.trim());
  }

  const page = await request(frontend);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Workify/);
  assert.match(html, /<html lang="ru">/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
  assert(assets.some(asset => asset.endsWith('.js')), 'The built React entry point must exist');
  assert(assets.some(asset => asset.endsWith('.css')), 'Built styles must exist');
  for (const asset of assets) assert.equal((await request(`${frontend}${asset}`)).status, 200);
  assert.equal((await request(`${frontend}/workspace`)).status, 200, 'SPA routes must serve index.html');
  for (const path of ['/.env', '/assets/missing.js', '/api/unknown']) {
    assert.equal((await request(`${frontend}${path}`)).status, 404, `${path} must not fall back to the SPA`);
  }
  console.log('PASS: Node 24, PostgreSQL 17, migrations, React assets, same-origin API and health checks');

  const marker = randomUUID();
  const filename = `smoke-${marker}.txt`;
  const before = (await compose('ps', '-q', 'postgres', 'backend')).stdout.trim().split(/\r?\n/);
  const ledgerBefore = await sql('SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM workify.schema_migrations m');
  await sql(`INSERT INTO workify.categories (slug, name) VALUES ('smoke-persistence', '${marker}')`);
  await backendNode(`import { writeFile } from 'node:fs/promises'; await writeFile(process.env.UPLOAD_DIR + '/${filename}', '${marker}');`);
  assert.equal((await request(`${backend}/uploads/${filename}`)).status, 404, 'The uploads volume must not be served publicly');
  await compose('up', '-d', '--force-recreate', '--wait', '--wait-timeout', '120');
  const after = (await compose('ps', '-q', 'postgres', 'backend')).stdout.trim().split(/\r?\n/);
  assert.equal(before.length, 2);
  assert.equal(after.length, 2);
  assert(after.every(id => !before.includes(id)), 'PostgreSQL and backend containers must actually be replaced');
  assert.equal(await sql("SELECT name FROM workify.categories WHERE slug='smoke-persistence'"), marker);
  assert.equal(await backendNode(`import { readFile } from 'node:fs/promises'; console.log(await readFile(process.env.UPLOAD_DIR + '/${filename}', 'utf8'));`), marker);
  assert.equal(await sql('SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM workify.schema_migrations m'), ledgerBefore);
  frontend = await serviceUrl('frontend', 8080);
  backend = await serviceUrl('backend', 3000);
  await expectHealth(frontend, 200, 'up');
  console.log('PASS: postgres_data and uploads_data survive real container replacement; migrations are not reapplied');

  await compose('stop', 'postgres');
  await expectHealth(backend, 503, 'down');
  await expectHealth(frontend, 503, 'down');
  assert.equal((await request(frontend)).status, 200, 'Frontend remains available while the database is down');
  await compose('up', '-d', '--wait', '--wait-timeout', '120');
  await expectHealth(backend, 200, 'up');
  console.log('PASS: database outage returns 503, and the backend reconnects after PostgreSQL restarts');

  await compose('stop', 'backend');
  const response = await request(`${frontend}/api/health`);
  assert.equal(response.status, 502);
  const errorBody = await response.json();
  assert.deepEqual(errorBody, { status: 'error', message: 'Сервис временно недоступен' });
  assert.equal((await request(`${frontend}/healthz`)).status, 200);
  await compose('up', '-d', '--wait', '--wait-timeout', '120');
  await expectHealth(frontend, 200, 'up');
  console.log('PASS: proxy returns safe JSON on backend outage and recovers after restart');
  console.log('All infrastructure checks passed.');
} catch (error) {
  console.error(error.stderr || error.stack || String(error));
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      assert.match(project, /^workify-smoke-[a-f0-9]{8}$/);
      const ids = (await compose('ps', '--all', '--quiet')).stdout.trim().split(/\r?\n/).filter(Boolean);
      for (const id of ids) {
        const label = (await docker('inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', id)).stdout.trim();
        assert.equal(label, project, 'Refusing to remove resources from another Compose project');
      }
      await compose('down', '--volumes', '--rmi', 'local');
      console.log('Disposable Compose project, test volumes and test images removed.');
    } catch (error) {
      console.error(`Test cleanup failed for ${project}: ${error.stderr || error.message}`);
      process.exitCode = 1;
    }
  }
}
