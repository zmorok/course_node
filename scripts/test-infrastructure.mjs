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
  AUTH_JWT_SECRET: randomBytes(32).toString('hex'),
  AUTH_COOKIE_SECURE: 'false',
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

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
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
  assert.equal(await sql('SELECT count(*) FROM workify.schema_migrations'), '4');
  assert.equal(await sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='workify' AND table_type='BASE TABLE'"), '30');
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
  const clientTests = await compose('run', '--rm', '--no-deps', '--volume', './frontend/test:/app/test:ro',
    '--volume', './frontend/src/api.js:/app/src/api.js:ro', 'frontend', 'npm', 'test');
  console.log(clientTests.stdout.trim());

  const authHeaders = { 'Content-Type': 'application/json', 'X-Workify-Client': 'browser' };
  const authSuffix = randomUUID().replaceAll('-', '');
  const registration = await request(`${frontend}/api/auth/register`, { method: 'POST', headers: authHeaders,
    body: JSON.stringify({ email: `${authSuffix}@example.invalid`, username: `smoke_${authSuffix}`,
      password: 'isolated-smoke-password', firstName: 'Smoke', lastName: 'Test' }) });
  assert.equal(registration.status, 201);
  const account = await registration.json();
  const refreshCookie = registration.headers.get('set-cookie').split(';')[0];
  assert.match(registration.headers.get('set-cookie'), /HttpOnly/);
  const authorization = { Authorization: `Bearer ${account.accessToken}` };
  assert.equal((await request(`${frontend}/api/auth/me`, { headers: authorization })).status, 200);
  assert.equal((await request(`${frontend}/api/auth/me`)).status, 401);
  assert.equal((await request(`${frontend}/api/admin/access`, { headers: authorization })).status, 403);
  const skillCatalog = await (await request(`${frontend}/api/skills`)).json();
  const profileSkillId = skillCatalog.skills[0].id;
  const profileChange = await request(`${frontend}/api/me/profile`, { method: 'PATCH', headers: { ...authHeaders, ...authorization },
    body: JSON.stringify({ firstName: 'Smoke updated', headline: 'Сохранённый профиль', phone: '+375291234567' }) });
  assert.equal(profileChange.status, 200);
  const skillChange = await request(`${frontend}/api/me/skills`, { method: 'PUT', headers: { ...authHeaders, ...authorization },
    body: JSON.stringify({ skillIds: [profileSkillId] }) });
  assert.equal(skillChange.status, 200);
  const publicProfileResponse = await request(`${frontend}/api/users/${account.user.id}`);
  assert.equal(publicProfileResponse.status, 200);
  const publicProfile = (await publicProfileResponse.json()).profile;
  assert.equal(publicProfile.skills[0].id, profileSkillId);
  assert(!Object.hasOwn(publicProfile, 'email')); assert(!Object.hasOwn(publicProfile, 'phone'));
  console.log('PASS: profile editing, persisted skills and private contact isolation through the frontend proxy');
  const fileText='Портфолио: файл должен пережить замену контейнера';
  const form=new FormData();form.append('file',new Blob([fileText],{type:'text/plain'}),'Результат.txt');
  const uploaded=await request(`${frontend}/api/files`,{method:'POST',headers:authorization,body:form});
  assert.equal(uploaded.status,201);
  const storedFile=(await uploaded.json()).file;
  assert.equal((await request(`${frontend}/api/files/${storedFile.id}`)).status,404,'Unattached uploads are private');
  const portfolioCreated=await request(`${frontend}/api/me/portfolio`,{method:'POST',headers:{...authHeaders,...authorization},
    body:JSON.stringify({title:'Проверка сохранности',description:'Файл и метаданные в разных хранилищах',links:['https://example.org'],fileIds:[storedFile.id]})});
  assert.equal(portfolioCreated.status,201);
  const portfolioId=(await portfolioCreated.json()).item.id;
  assert.equal(await (await request(`${frontend}/api/files/${storedFile.id}`)).text(),fileText);
  assert.equal((await (await request(`${frontend}/api/users/${account.user.id}/portfolio`)).json()).items[0].id,portfolioId);
  const categories=(await (await request(`${frontend}/api/categories`)).json()).categories;
  const projectForm=new FormData();projectForm.append('file',new Blob(['Задание проекта'],{type:'text/plain'}),'Задание.txt');
  const projectUpload=await request(`${frontend}/api/files`,{method:'POST',headers:authorization,body:projectForm});assert.equal(projectUpload.status,201);
  const projectFile=(await projectUpload.json()).file;
  const draftResponse=await request(`${frontend}/api/projects`,{method:'POST',headers:{...authHeaders,...authorization},
    body:JSON.stringify({title:`smoke-project-${authSuffix}`,description:'Разработать API проекта',categoryId:categories[0].id,budget:'2500.00',skillIds:[profileSkillId],fileIds:[projectFile.id]})});
  assert.equal(draftResponse.status,201);const draftProject=(await draftResponse.json()).project;
  assert.equal((await request(`${frontend}/api/projects/${draftProject.id}`)).status,404);
  assert.equal((await request(`${frontend}/api/files/${projectFile.id}`)).status,404);
  const publishResponse=await request(`${frontend}/api/projects/${draftProject.id}/publish`,{method:'POST',headers:{...authHeaders,...authorization},body:'{}'});assert.equal(publishResponse.status,200);
  const projectSearch=await request(`${frontend}/api/projects?search=${authSuffix}&category=${categories[0].slug}&minBudget=2000&sort=budget_desc`,{headers:authorization});
  const projectResults=await projectSearch.json();assert.equal(projectResults.total,1);assert.equal(projectResults.items[0].id,draftProject.id);assert.equal(projectResults.items[0].isOwn,true);
  assert.equal(await (await request(`${frontend}/api/files/${projectFile.id}`)).text(),'Задание проекта');
  console.log('PASS: draft privacy, publication, server-side project filters, ownership badge and attachments through the proxy');
  await compose('exec', '-T', 'backend', 'node', 'src/commands/promote-admin.js', account.user.email);
  assert.equal((await request(`${frontend}/api/admin/access`, { headers: authorization })).status, 200);
  console.log('PASS: registration, HttpOnly cookie, current user and CLIENT restriction through the frontend proxy');

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
  const restored = await request(`${frontend}/api/auth/refresh`, { method: 'POST', headers: { ...authHeaders, Cookie: refreshCookie } });
  assert.equal(restored.status, 200, 'The session and JWT signing key must survive backend recreation');
  const renewed = await restored.json();
  const renewedCookie = restored.headers.get('set-cookie').split(';')[0];
  assert.equal(renewed.user.id, account.user.id);
  const persistedProfile = await (await request(`${frontend}/api/me/profile`, { headers: authorization })).json();
  assert.equal(persistedProfile.profile.headline, 'Сохранённый профиль');
  assert.equal(persistedProfile.profile.skills[0].id, profileSkillId);
  const persistedFile=await request(`${frontend}/api/files/${storedFile.id}`,{headers:authorization});
  assert.equal(persistedFile.status,200);assert.equal(await persistedFile.text(),fileText);
  assert.equal(await sql(`SELECT count(*) FROM workify.portfolio_files WHERE portfolio_item_id='${portfolioId}' AND file_id='${storedFile.id}'`),'1');
  console.log('PASS: API-uploaded bytes, metadata and portfolio attachments survive container replacement');
  const persistedProjectResponse=await request(`${frontend}/api/projects/${draftProject.id}`,{headers:authorization});assert.equal(persistedProjectResponse.status,200);
  const persistedProject=(await persistedProjectResponse.json()).project;
  assert.equal(persistedProject.status,'OPEN');assert.equal(persistedProject.budget,'2500.00');assert.equal(persistedProject.files[0].id,projectFile.id);
  assert.equal(await (await request(`${frontend}/api/files/${projectFile.id}`,{headers:authorization})).text(),'Задание проекта');
  console.log('PASS: published project, skills, budget and attachment survive container replacement');
  assert.equal((await request(`${frontend}/api/auth/me`, { headers: authorization })).status, 200);
  const out = await request(`${frontend}/api/auth/logout`, { method: 'POST', headers: { ...authHeaders, Cookie: renewedCookie } });
  assert.equal(out.status, 204);
  assert.equal((await request(`${frontend}/api/auth/me`, { headers: authorization })).status, 401);
  assert.equal((await request(`${frontend}/api/auth/me`, { headers: { Authorization: `Bearer ${renewed.accessToken}` } })).status, 401);
  console.log('PASS: session restoration after container replacement and immediate JWT revocation on logout');
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
  console.error([error.stdout, error.stderr].filter(Boolean).join('\n') || error.stack || String(error));
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
