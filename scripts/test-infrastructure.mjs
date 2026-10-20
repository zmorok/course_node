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
  const authorRegistration=await request(`${frontend}/api/auth/register`,{method:'POST',headers:authHeaders,body:JSON.stringify({email:`author-${authSuffix}@example.invalid`,username:`offer_${authSuffix}`,password:'isolated-author-password',firstName:'Author',lastName:'Test'})});
  assert.equal(authorRegistration.status,201);const author=await authorRegistration.json();
  const authorHeaders={...authHeaders,Authorization:`Bearer ${author.accessToken}`};
  const offer={message:'Готов выполнить проект',offeredPrice:'2100.50',offeredDeadlineAt:new Date(Date.now()+30*86400000).toISOString()};
  const offered=await request(`${frontend}/api/projects/${draftProject.id}/proposals`,{method:'POST',headers:authorHeaders,body:JSON.stringify(offer)});assert.equal(offered.status,201);
  const proposal=(await offered.json()).proposal;
  assert.equal((await request(`${frontend}/api/projects/${draftProject.id}/proposals`,{method:'POST',headers:authorHeaders,body:JSON.stringify(offer)})).status,409);
  const accepted=await request(`${frontend}/api/proposals/${proposal.id}/accept`,{method:'POST',headers:{...authHeaders,...authorization},body:'{}'});assert.equal(accepted.status,200);
  const agreement=(await accepted.json()).proposal.order;assert.equal(agreement.agreedPrice,'2100.50');assert.equal(agreement.files[0].id,projectFile.id);
  assert.equal((await request(`${frontend}/api/projects/${draftProject.id}`)).status,404);
  assert.equal((await request(`${frontend}/api/files/${projectFile.id}`)).status,404);
  assert.equal(await (await request(`${frontend}/api/files/${projectFile.id}`,{headers:authorHeaders})).text(),'Задание проекта');
  console.log('PASS: private proposals, duplicate prevention, acceptance, order snapshot and participant-only files through the proxy');
  assert.equal((await request(`${frontend}/api/me/skills`,{method:'PUT',headers:authorHeaders,body:JSON.stringify({skillIds:[profileSkillId]})})).status,200);
  const directoryResponse=await request(`${frontend}/api/freelancers?search=${author.user.username}&skill=${skillCatalog.skills[0].slug}&sort=name`);assert.equal(directoryResponse.status,200);
  const directory=await directoryResponse.json();assert.equal(directory.total,1);assert.equal(directory.items[0].id,author.user.id);assert(!Object.hasOwn(directory.items[0],'email'));
  const invitedProjectResponse=await request(`${frontend}/api/projects`,{method:'POST',headers:{...authHeaders,...authorization},body:JSON.stringify({title:`smoke-invitation-${authSuffix}`,description:'Приглашение исполнителя',categoryId:categories[0].id,budget:'2300.00'})});assert.equal(invitedProjectResponse.status,201);const invitedProject=(await invitedProjectResponse.json()).project;
  assert.equal((await request(`${frontend}/api/projects/${invitedProject.id}/publish`,{method:'POST',headers:{...authHeaders,...authorization},body:'{}'})).status,200);
  const picker=await request(`${frontend}/api/freelancers/${author.user.id}/projects`,{headers:authorization});assert.equal(picker.status,200);assert((await picker.json()).projects.some(row=>row.id===invitedProject.id));
  const invitationResponse=await request(`${frontend}/api/projects/${invitedProject.id}/invitations`,{method:'POST',headers:{...authHeaders,...authorization},body:JSON.stringify({freelancerId:author.user.id,message:'Приглашаю выполнить проект',offeredPrice:'1900.75',offeredDeadlineAt:offer.offeredDeadlineAt})});assert.equal(invitationResponse.status,201);const invitation=(await invitationResponse.json()).invitation;
  assert.equal((await request(`${frontend}/api/invitations/${invitation.id}/accept`,{method:'POST',headers:{...authHeaders,...authorization},body:'{}'})).status,404);
  const invitationAccepted=await request(`${frontend}/api/invitations/${invitation.id}/accept`,{method:'POST',headers:authorHeaders,body:'{}'});assert.equal(invitationAccepted.status,200);const invitationOrder=(await invitationAccepted.json()).invitation.order;assert.equal(invitationOrder.agreedPrice,'1900.75');
  console.log('PASS: public freelancer search and skill filtering, own project picker, recipient-only acceptance and invitation order through the proxy');
  const customerOrders=await (await request(`${frontend}/api/me/orders?mode=customer&scope=active`,{headers:authorization})).json();
  assert.equal(customerOrders.total,2);assert(customerOrders.items.every(row=>row.participantMode==='customer'));
  const freelancerOrders=await (await request(`${frontend}/api/me/orders?mode=freelancer&scope=active`,{headers:authorHeaders})).json();
  assert.equal(freelancerOrders.total,2);assert(freelancerOrders.items.every(row=>row.participantMode==='freelancer'));
  assert.equal((await (await request(`${frontend}/api/me/orders?mode=customer&scope=history`,{headers:authorization})).json()).total,0);
  const orderResponse=await request(`${frontend}/api/orders/${agreement.id}`,{headers:authorHeaders});assert.equal(orderResponse.status,200);
  const orderDetails=(await orderResponse.json()).order;assert.equal(orderDetails.title,draftProject.title);assert.equal(orderDetails.files[0].id,projectFile.id);
  assert.equal(orderDetails.permissions.submit,true);assert.equal(orderDetails.permissions.acceptSubmission,false);
  assert.equal((await request(`${frontend}/api/orders/${agreement.id}`)).status,401);
  assert.equal((await request(`${frontend}/api/orders/${agreement.id}`,{method:'PATCH',headers:authorHeaders,body:JSON.stringify({status:'COMPLETED'})})).status,404);
  console.log('PASS: customer/freelancer order lists, empty history, private snapshots, action matrix and rejection of arbitrary status changes');
  const orderPath=`${frontend}/api/orders/${agreement.id}`;
  const deadlineResponse=await request(`${orderPath}/deadline-requests`,{method:'POST',headers:authorHeaders,body:JSON.stringify({proposedDeadlineAt:new Date(Date.now()+40*86400000).toISOString(),reason:'Дополнительная проверка результата'})});assert.equal(deadlineResponse.status,201);const deadlineRequest=await deadlineResponse.json();
  assert.equal((await request(`${orderPath}/deadline-requests/${deadlineRequest.requestId}/approve`,{method:'POST',headers:{...authHeaders,...authorization},body:'{}'})).status,200);
  const resultText='Сохранённая первая версия результата';const resultForm=new FormData();resultForm.append('file',new Blob([resultText],{type:'text/plain'}),'Результат.txt');const resultUpload=await request(`${frontend}/api/files`,{method:'POST',headers:{Authorization:authorHeaders.Authorization},body:resultForm});assert.equal(resultUpload.status,201);const resultFile=(await resultUpload.json()).file;
  const pendingResponse=await request(`${orderPath}/deadline-requests`,{method:'POST',headers:authorHeaders,body:JSON.stringify({proposedDeadlineAt:new Date(Date.now()+50*86400000).toISOString(),reason:'Проверка закрытия при сдаче'})});assert.equal(pendingResponse.status,201);const pendingRequest=await pendingResponse.json();
  const firstResult=await request(`${orderPath}/submissions`,{method:'POST',headers:authorHeaders,body:JSON.stringify({comment:'Первая версия',fileIds:[resultFile.id]})});assert.equal(firstResult.status,201);const firstVersion=await firstResult.json();
  assert.equal((await request(`${orderPath}/deadline-requests/${pendingRequest.requestId}/approve`,{method:'POST',headers:{...authHeaders,...authorization},body:'{}'})).status,409);
  assert.equal((await request(`${orderPath}/submissions/${firstVersion.submissionId}/revision`,{method:'POST',headers:{...authHeaders,...authorization},body:JSON.stringify({comment:'Исправить замечания'})})).status,200);
  const nextResult=await request(`${orderPath}/submissions`,{method:'POST',headers:authorHeaders,body:JSON.stringify({comment:'Исправленная версия',links:['https://example.org/result']})});assert.equal(nextResult.status,201);const nextVersion=await nextResult.json();assert.equal(nextVersion.version,2);
  assert.equal((await request(`${orderPath}/submissions/${firstVersion.submissionId}/accept`,{method:'POST',headers:{...authHeaders,...authorization},body:'{}'})).status,409);
  assert.equal((await request(`${orderPath}/submissions/${nextVersion.submissionId}/accept`,{method:'POST',headers:{...authHeaders,...authorization},body:'{}'})).status,200);
  assert.equal(await (await request(`${frontend}/api/files/${resultFile.id}`,{headers:authorization})).text(),resultText);assert.equal((await request(`${frontend}/api/files/${resultFile.id}`)).status,404);
  console.log('PASS: deadline approval, pending expiry, private version files, revision, resubmission and atomic acceptance through the proxy');
  assert.equal((await request(`${frontend}/api/orders/${invitationOrder.id}/cancel`,{method:'POST',headers:authorHeaders,body:JSON.stringify({reason:'Исполнитель отказался от работы'})})).status,200);
  assert.equal((await request(`${frontend}/api/projects/${invitedProject.id}`)).status,200);
  const replacementRegistration=await request(`${frontend}/api/auth/register`,{method:'POST',headers:authHeaders,body:JSON.stringify({email:`replacement-${authSuffix}@example.invalid`,username:`new_${authSuffix}`,password:'isolated-replacement-password',firstName:'Replacement',lastName:'Test'})});assert.equal(replacementRegistration.status,201);const replacement=await replacementRegistration.json(),replacementHeaders={...authHeaders,Authorization:`Bearer ${replacement.accessToken}`};
  const replacementOffer=await request(`${frontend}/api/projects/${invitedProject.id}/invitations`,{method:'POST',headers:{...authHeaders,...authorization},body:JSON.stringify({freelancerId:replacement.user.id,...offer})});assert.equal(replacementOffer.status,201);const replacementInvitation=(await replacementOffer.json()).invitation;
  const replacementAccept=await request(`${frontend}/api/invitations/${replacementInvitation.id}/accept`,{method:'POST',headers:replacementHeaders,body:'{}'});assert.equal(replacementAccept.status,200);const replacementOrder=(await replacementAccept.json()).invitation.order;assert.notEqual(replacementOrder.id,invitationOrder.id);
  assert.equal((await request(`${frontend}/api/orders/${invitationOrder.id}`,{headers:replacementHeaders})).status,404);
  const cancelledTimeline=await (await request(`${frontend}/api/orders/${invitationOrder.id}/events`,{headers:authorHeaders})).json();assert.equal(cancelledTimeline.items[0].type,'ORDER_CANCELLED');assert.equal(cancelledTimeline.items[0].metadata.reason,'Исполнитель отказался от работы');
  console.log('PASS: cancellation, project reopening, replacement freelancer, private old history and event timeline through the proxy');
  const reviewsPath=`${frontend}/api/orders/${agreement.id}/reviews`;
  const ownerReviewResponse=await request(reviewsPath,{method:'POST',headers:{...authHeaders,...authorization},body:JSON.stringify({rating:5,text:'Результат принят после доработки'})});assert.equal(ownerReviewResponse.status,201);const ownerReview=(await ownerReviewResponse.json()).review;assert.equal(ownerReview.recipient.id,author.user.id);
  assert.equal((await request(reviewsPath,{method:'POST',headers:authorHeaders,body:JSON.stringify({rating:4,text:'Заказчик предоставил подробные замечания'})})).status,201);
  assert.equal((await request(`${frontend}/api/orders/${invitationOrder.id}/reviews`,{method:'POST',headers:{...authHeaders,...authorization},body:JSON.stringify({rating:3,text:'Работа отменена, причины обсуждены'})})).status,201);
  assert.equal((await request(`${frontend}/api/orders/${invitationOrder.id}/reviews`,{method:'POST',headers:authorHeaders,body:JSON.stringify({rating:5,text:'Заказчик спокойно принял отказ'})})).status,201);
  assert.equal((await request(`${frontend}/api/reviews/${ownerReview.id}`,{method:'DELETE',headers:authorization})).status,200);
  assert.equal((await request(reviewsPath,{method:'POST',headers:{...authHeaders,...authorization},body:JSON.stringify({rating:5,text:'Второй отзыв запрещён'})})).status,409);
  assert.equal((await request(`${frontend}/api/reviews/${ownerReview.id}`,{method:'PUT',headers:{...authHeaders,...authorization},body:JSON.stringify({rating:4,text:'Обновлённый отзыв о результате'})})).status,200);
  assert.equal((await request(`${frontend}/api/reviews/${ownerReview.id}/restore`,{method:'POST',headers:{...authHeaders,...authorization},body:'{}'})).status,200);
  const publicReviews=await (await request(`${frontend}/api/users/${author.user.id}/reviews?mode=freelancer`)).json();assert.equal(publicReviews.total,2);assert.equal(publicReviews.rating,'3.50');assert(!Object.hasOwn(publicReviews.items[0].order,'title'));
  assert.equal((await (await request(`${frontend}/api/users/${account.user.id}`)).json()).profile.customerRating,'4.50');
  assert.equal((await (await request(`${frontend}/api/me/reviews?mode=freelancer&direction=received`,{headers:authorHeaders})).json()).total,2);
  console.log('PASS: reciprocal reviews, server targets, author editing/hiding/restoration and database-backed role ratings through the proxy');
  const evidenceText='Приватное доказательство жалобы';const evidenceForm=new FormData();evidenceForm.append('file',new Blob([evidenceText],{type:'text/plain'}),'Доказательство.txt');
  const evidenceUpload=await request(`${frontend}/api/files`,{method:'POST',headers:{Authorization:authorHeaders.Authorization},body:evidenceForm});assert.equal(evidenceUpload.status,201);const evidence=(await evidenceUpload.json()).file;
  const complaintResponse=await request(`${frontend}/api/orders/${agreement.id}/complaints`,{method:'POST',headers:authorHeaders,body:JSON.stringify({reason:'Проверка договорённостей',description:'Приватное обращение после завершения',fileIds:[evidence.id]})});assert.equal(complaintResponse.status,201);const complaint=(await complaintResponse.json()).complaint;assert.equal(complaint.target.id,account.user.id);
  assert.equal((await request(`${frontend}/api/orders/${agreement.id}/complaints`,{method:'POST',headers:authorHeaders,body:JSON.stringify({reason:'Повтор',description:'Вторая жалоба'})})).status,409);
  assert.equal((await request(`${frontend}/api/me/complaints/${complaint.id}`,{headers:authorization})).status,404);assert.equal((await request(`${frontend}/api/files/${evidence.id}`,{headers:authorization})).status,404);
  console.log('PASS: immutable terminal-order complaint, server target, duplicate prevention and private evidence through the proxy');
  await compose('exec', '-T', 'backend', 'node', 'src/commands/promote-admin.js', account.user.email);
  assert.equal((await request(`${frontend}/api/admin/access`, { headers: authorization })).status, 200);
  const warningResponse=await request(`${frontend}/api/admin/users/${author.user.id}/warnings`,{method:'POST',headers:{...authHeaders,...authorization},body:JSON.stringify({message:'Соблюдайте правила общения'})});assert.equal(warningResponse.status,201);const warning=(await warningResponse.json()).warning;
  assert.equal((await (await request(`${frontend}/api/me/warnings`,{headers:authorHeaders})).json()).items[0].warningId,warning.id);
  console.log('PASS: admin-only warning issuance and private read-only warning history through the proxy');
  const moderatorRegistration=await request(`${frontend}/api/auth/register`,{method:'POST',headers:authHeaders,body:JSON.stringify({email:`moderator_${authSuffix}@example.invalid`,username:`mod_${authSuffix}`,password:'isolated-smoke-password',firstName:'Moderator',lastName:'Test'})});assert.equal(moderatorRegistration.status,201);const moderator=await moderatorRegistration.json();await compose('exec','-T','backend','node','src/commands/promote-admin.js',moderator.user.email);const moderatorHeaders={...authHeaders,Authorization:`Bearer ${moderator.accessToken}`};
  const complaintPath=`${frontend}/api/admin/complaints/${complaint.id}`;assert.equal((await request(`${complaintPath}/claim`,{method:'POST',headers:moderatorHeaders,body:'{}'})).status,200);
  const moderationContext=await (await request(complaintPath,{headers:moderatorHeaders})).json();assert.equal(moderationContext.order.id,agreement.id);assert.equal((await request(`${frontend}/api/files/${evidence.id}`,{headers:moderatorHeaders})).status,200);
  assert.equal((await request(`${complaintPath}/resolve`,{method:'POST',headers:moderatorHeaders,body:JSON.stringify({resolutionNote:'Проверка обращения завершена',actions:[{targetId:author.user.id,type:'WARNING',reason:'Уточняйте договорённости заранее'}]})})).status,200);
  assert.equal((await (await request(`${frontend}/api/me/complaints/${complaint.id}`,{headers:authorHeaders})).json()).complaint.status,'RESOLVED');assert.equal((await (await request(`${frontend}/api/me/warnings`,{headers:authorHeaders})).json()).total,2);
  console.log('PASS: admin complaint context, claim and atomic linked warning resolution through the proxy');
  assert.equal((await request(`${frontend}/api/me/orders`,{headers:authorization})).status,403);
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
  assert.equal(persistedProject.status,'COMPLETED');assert.equal(persistedProject.budget,'2500.00');assert.equal(persistedProject.files[0].id,projectFile.id);
  assert.equal(await (await request(`${frontend}/api/files/${projectFile.id}`,{headers:authorization})).text(),'Задание проекта');
  const persistedOfferResponse=await request(`${frontend}/api/proposals/${proposal.id}`,{headers:authorHeaders});assert.equal(persistedOfferResponse.status,200);
  const persistedOffer=(await persistedOfferResponse.json()).proposal;assert.equal(persistedOffer.status,'ACCEPTED');assert.equal(persistedOffer.order.id,agreement.id);assert.equal(persistedOffer.order.agreedPrice,'2100.50');
  assert.equal(await (await request(`${frontend}/api/files/${projectFile.id}`,{headers:authorHeaders})).text(),'Задание проекта');
  console.log('PASS: assigned project, accepted proposal, agreement snapshot and private attachment survive container replacement');
  const restoredOrders=await (await request(`${frontend}/api/me/orders?mode=freelancer`,{headers:authorHeaders})).json();assert.equal(restoredOrders.total,0);
  assert.equal((await (await request(`${frontend}/api/me/orders?mode=freelancer&scope=history`,{headers:authorHeaders})).json()).total,2);
  for(const id of [agreement.id,invitationOrder.id]){const response=await request(`${frontend}/api/orders/${id}`,{headers:authorHeaders});assert.equal(response.status,200);const order=(await response.json()).order;assert.equal(order.status,id===agreement.id?'COMPLETED':'CANCELLED');assert.equal(order.permissions.submit,false);}
  const restoredReplacement=await request(`${frontend}/api/orders/${replacementOrder.id}`,{headers:replacementHeaders});assert.equal(restoredReplacement.status,200);assert.equal((await restoredReplacement.json()).order.status,'IN_PROGRESS');
  const restoredTimeline=await (await request(`${frontend}/api/orders/${invitationOrder.id}/events`,{headers:authorHeaders})).json();assert.equal(restoredTimeline.items[0].type,'ORDER_CANCELLED');
  const persistedReviews=await (await request(`${frontend}/api/users/${author.user.id}/reviews?mode=freelancer`)).json();assert.equal(persistedReviews.total,2);assert.equal(persistedReviews.rating,'3.50');assert(persistedReviews.items.some(row=>row.id===ownerReview.id&&row.text==='Обновлённый отзыв о результате'));
  assert.equal((await (await request(`${frontend}/api/orders/${agreement.id}/reviews`,{headers:authorHeaders})).json()).items.length,2);
  console.log('PASS: public reviews, private order feedback and recalculated ratings survive container replacement');
  const restoredComplaint=await request(`${frontend}/api/me/complaints/${complaint.id}`,{headers:authorHeaders});assert.equal(restoredComplaint.status,200);assert.equal((await restoredComplaint.json()).complaint.status,'RESOLVED');assert.equal(await (await request(`${frontend}/api/files/${evidence.id}`,{headers:authorHeaders})).text(),evidenceText);
  const restoredWarnings=(await (await request(`${frontend}/api/me/warnings`,{headers:authorHeaders})).json());assert(restoredWarnings.items.some(item=>item.warningId===warning.id));assert(restoredWarnings.items.some(item=>item.complaintId===complaint.id));
  console.log('PASS: submitted complaint, private evidence bytes and warning history survive container replacement');
  const restoredVersions=await (await request(`${frontend}/api/orders/${agreement.id}/submissions`,{headers:authorHeaders})).json();assert.equal(restoredVersions.total,2);assert.equal(restoredVersions.items[0].status,'ACCEPTED');assert.equal(restoredVersions.items[1].reviewComment,'Исправить замечания');assert.equal(restoredVersions.items[1].files[0].id,resultFile.id);assert.equal(await (await request(`${frontend}/api/files/${resultFile.id}`,{headers:authorHeaders})).text(),resultText);
  const restoredDeadlines=await (await request(`${frontend}/api/orders/${agreement.id}/deadline-requests`,{headers:authorHeaders})).json();assert.equal(restoredDeadlines.total,2);assert.equal(restoredDeadlines.items[0].status,'EXPIRED');assert.equal(restoredDeadlines.items[1].status,'APPROVED');
  console.log('PASS: versions, reviewer comments, private result bytes, deadline decisions and completed order/project survive container replacement');
  console.log('PASS: both order sources, participant mode and action matrix survive container replacement');
  const persistedInvitationResponse=await request(`${frontend}/api/invitations/${invitation.id}`,{headers:authorHeaders});assert.equal(persistedInvitationResponse.status,200);const persistedInvitation=(await persistedInvitationResponse.json()).invitation;
  assert.equal(persistedInvitation.status,'ACCEPTED');assert.equal(persistedInvitation.project.status,'IN_PROGRESS');assert.equal(persistedInvitation.order.id,invitationOrder.id);assert.equal(persistedInvitation.order.agreedPrice,'1900.75');
  console.log('PASS: invitation, its agreed terms and order survive container replacement alongside the proposal order');
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
