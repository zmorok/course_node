import test,{ after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,readdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/config/env.js';
import { createDatabasePool } from '../../src/config/database.js';
import { withTransaction } from '../../src/repositories/transaction.js';
import { createAuthRepository } from '../../src/repositories/auth.repository.js';
import { createAuthService } from '../../src/services/auth.service.js';
import { createAccessTokens } from '../../src/utils/tokens.js';
import { createFileRepository } from '../../src/repositories/file.repository.js';
import { createFileService } from '../../src/services/file.service.js';
import { createLocalStorage } from '../../src/storage/local-storage.js';
import { createPortfolioRepository } from '../../src/repositories/portfolio.repository.js';
import { createPortfolioService } from '../../src/services/portfolio.service.js';
import { createApiRouter } from '../../src/routes/index.js';
import { startApp } from '../helpers/http.js';
if(process.env.WORKIFY_DB_TESTS!=='1') throw new Error('Use the disposable infrastructure test database');
const config=loadConfig({...process.env,NODE_ENV:'test'}), pool=createDatabasePool(config.database), owned=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6x2kAAAAASUVORK5CYII=','base64');
// Immutable audit keeps its actors until the disposable database is removed.
after(()=>pool.end());
const options=(token,method='GET',body)=>({method,headers:{ ...(token?{Authorization:`Bearer ${token}`}:{ }),
  'Content-Type':'application/json','X-Workify-Client':'browser' },...(body===undefined?{}:{body:JSON.stringify(body)})});
async function setup(context) {
  const directory=await mkdtemp(join(tmpdir(),'workify-files-')); context.after(()=>rm(directory,{recursive:true,force:true}));
  const repository=createFileRepository(pool), transaction=operation=>withTransaction(pool,client=>operation(createFileRepository(client)));
  const fileService=createFileService({repository,transaction,storage:createLocalStorage(directory)});
  const portfolioService=createPortfolioService({repository:createPortfolioRepository(pool),fileService,
    transaction:operation=>withTransaction(pool,client=>operation(createPortfolioRepository(client),createFileRepository(client)))});
  const authService=await createAuthService({repository:createAuthRepository(pool),
    transaction:operation=>withTransaction(pool,client=>operation(createAuthRepository(client))),accessTokens:createAccessTokens(config.auth),sessionTtlDays:30});
  const app=await startApp(context,createApiRouter({authService,authConfig:config.auth,fileService,portfolioService,healthService:{check:async()=>({status:'ok'})}}));
  return {...app,directory,fileService,async register(){
    const suffix=randomUUID().replaceAll('-','');
    const result=await app.request('/api/auth/register',options(null,'POST',{email:`${suffix}@example.invalid`,username:`f_${suffix}`,firstName:'Файл',lastName:'Тест',password:'file test password'}));
    assert.equal(result.response.status,201); owned.push(result.body.user.id);
    return {id:result.body.user.id,token:result.body.accessToken};
  },upload:async(token,buffer=Buffer.from('Описание проекта'),name='Описание.txt',type='text/plain')=>{
    const form=new FormData(); form.append('file',new Blob([buffer],{type}),name);
    return app.request('/api/files',{method:'POST',headers:{...(token?{Authorization:`Bearer ${token}`}:{})},body:form});
  }};
}
const item=(fileIds=[])=>({title:'Сайт команды',description:'Работа над сайтом\n<script>escaped</script>',links:['https://example.org/demo'],fileIds});

test('file upload persists only metadata with SHA-256; unlinked download is owner-only',async context=>{
  const app=await setup(context),owner=await app.register(),other=await app.register();
  assert.equal((await app.upload()).response.status,401);
  const result=await app.upload(owner.token); assert.equal(result.response.status,201,JSON.stringify(result.body));
  const file=result.body.file; assert.equal(file.originalName,'Описание.txt'); assert.match(file.sha256,/^[a-f0-9]{64}$/);
  assert(!JSON.stringify(file).includes('storage_key'));
  const row=(await pool.query('SELECT * FROM workify.stored_files WHERE id=$1',[file.id])).rows[0];
  assert.match(row.storage_key,/^[a-f0-9-]{36}\.txt$/); assert.equal(Number(row.size_bytes),Buffer.byteLength('Описание проекта'));
  assert.equal((await readdir(app.directory)).length,1);
  for(const token of [null,other.token]) assert.equal((await app.request(`/api/files/${file.id}`,options(token))).response.status,404);
  const download=await app.request(`/api/files/${file.id}`,options(owner.token));
  assert.equal(download.response.status,200); assert.equal(download.body.toString(),'Описание проекта');
  assert.match(download.response.headers.get('content-disposition'),/^attachment;/);
  assert.match(download.response.headers.get('cache-control'),/no-store/);
  assert.equal((await app.request(`/api/files/${file.id}`,options(other.token,'DELETE'))).response.status,404);
  assert.equal((await app.request(`/api/files/${file.id}`,options(owner.token,'DELETE'))).response.status,204);
  assert.deepEqual(await readdir(app.directory),[]);
});

test('unsupported, disguised, oversized, empty, multipart fields and traversal uploads leave no data',async context=>{
  const app=await setup(context),owner=await app.register();
  for(const [bytes,name,type,status] of [[Buffer.from('fake'),'fake.png','image/png',415],
    [Buffer.from('<svg/>'),'x.svg','image/svg+xml',415],[Buffer.from('text'),'../x.txt','text/plain',422],
    [Buffer.alloc(10*1024*1024+1),'huge.txt','text/plain',413],[Buffer.alloc(0),'empty.txt','text/plain',422]]) {
    const result=await app.upload(owner.token,bytes,name,type); assert.equal(result.response.status,status,JSON.stringify(result.body));
  }
  const form=new FormData();form.append('file',new Blob(['text'],{type:'text/plain'}),'x.txt');form.append('ownerId',owner.id);
  assert.equal((await app.request('/api/files',{method:'POST',headers:{Authorization:`Bearer ${owner.token}`},body:form})).response.status,422);
  assert.equal((await app.request('/api/files',options(owner.token,'POST',{}))).response.status,415);
  assert.deepEqual((await app.request('/api/files',options(owner.token))).body.files,[]);assert.deepEqual(await readdir(app.directory),[]);
});

test('portfolio CRUD publishes attached files and deletes detached objects without changing other users',async context=>{
  const app=await setup(context),owner=await app.register(),other=await app.register();
  const file=(await app.upload(owner.token)).body.file;
  const created=await app.request('/api/me/portfolio',options(owner.token,'POST',item([file.id])));
  assert.equal(created.response.status,201,JSON.stringify(created.body));const id=created.body.item.id;
  assert.equal((await app.request(`/api/files/${file.id}`)).response.status,200);
  const publicItems=(await app.request(`/api/users/${owner.id}/portfolio`)).body.items;
  assert.equal(publicItems[0].files[0].id,file.id);assert(!JSON.stringify(publicItems).includes('uploaded_by'));
  for(const method of ['GET','PUT','DELETE']) assert.equal((await app.request(`/api/me/portfolio/${id}`,options(other.token,method,method==='PUT'?item():undefined))).response.status,404);
  assert.equal((await app.request(`/api/files/${file.id}`,options(owner.token,'DELETE'))).response.status,409);
  const bad=await app.request(`/api/me/portfolio/${id}`,options(owner.token,'PUT',{...item(),title:''}));assert.equal(bad.response.status,422);
  assert.equal((await app.request(`/api/me/portfolio/${id}`,options(owner.token))).body.item.files.length,1);
  const updated=await app.request(`/api/me/portfolio/${id}`,options(owner.token,'PUT',{...item(),title:'Обновлено'}));assert.equal(updated.response.status,200);
  assert.equal((await app.request(`/api/files/${file.id}`)).response.status,404);assert.deepEqual(await readdir(app.directory),[]);
  const next=(await app.upload(owner.token,png,'photo.png','image/png')).body.file;
  await app.request(`/api/me/portfolio/${id}`,options(owner.token,'PUT',item([next.id])));
  assert.equal((await app.request(`/api/me/portfolio/${id}`,options(owner.token,'DELETE'))).response.status,204);
  assert.equal((await app.request(`/api/users/${owner.id}/portfolio`)).body.items.length,0);assert.deepEqual(await readdir(app.directory),[]);
});

test('foreign, missing, reused files and unsafe links cannot be attached or publish a partial item',async context=>{
  const app=await setup(context),owner=await app.register(),other=await app.register();
  const foreign=(await app.upload(other.token)).body.file;
  for(const fileId of [foreign.id,randomUUID()]) assert.equal((await app.request('/api/me/portfolio',options(owner.token,'POST',item([fileId])))).response.status,404);
  for(const links of [['javascript:alert(1)'],['https://user:secret@example.org']]) assert.equal((await app.request('/api/me/portfolio',options(owner.token,'POST',{...item(),links}))).response.status,422);
  assert.deepEqual((await app.request('/api/me/portfolio',options(owner.token))).body.items,[]);
  const own=(await app.upload(owner.token)).body.file;
  assert.equal((await app.request('/api/me/portfolio',options(owner.token,'POST',item([own.id])))).response.status,201);
  assert.equal((await app.request('/api/me/portfolio',options(owner.token,'POST',item([own.id])))).response.status,409);
});

test('avatar replacement enforces image ownership, publishes only the current image and cleans old bytes',async context=>{
  const app=await setup(context),owner=await app.register(),other=await app.register();
  const first=(await app.upload(owner.token,png,'Аватар.png','image/png')).body.file;
  assert.equal((await app.request('/api/me/avatar',options(other.token,'PUT',{fileId:first.id}))).response.status,404);
  assert.equal((await app.request('/api/me/avatar',options(owner.token,'PUT',{fileId:first.id}))).response.status,200);
  assert.equal((await app.request(`/api/files/${first.id}`)).response.status,200);
  const text=(await app.upload(owner.token)).body.file;
  assert.equal((await app.request('/api/me/avatar',options(owner.token,'PUT',{fileId:text.id}))).response.status,422);
  assert.equal((await app.request('/api/me/avatar',options(owner.token))).body.avatarFileId,first.id);
  const second=(await app.upload(owner.token,png,'Second.png','image/png')).body.file;
  await app.request('/api/me/avatar',options(owner.token,'PUT',{fileId:second.id}));
  assert.equal((await app.request(`/api/files/${first.id}`)).response.status,404);
  const image=await app.request(`/api/files/${second.id}`);assert.match(image.response.headers.get('content-disposition'),/^inline;/);assert.deepEqual(image.body,png);
  assert.equal((await app.request('/api/me/avatar',options(owner.token,'DELETE'))).response.status,204);
  assert.equal((await app.request(`/api/files/${second.id}`)).response.status,404);
});

test('concurrent attachment claims serialize; blocked and ADMIN profiles hide portfolio and media',async context=>{
  const app=await setup(context),owner=await app.register();
  const file=(await app.upload(owner.token)).body.file;
  const results=await Promise.all([1,2].map(()=>app.request('/api/me/portfolio',options(owner.token,'POST',item([file.id])))));
  assert.deepEqual(results.map(r=>r.response.status).sort(),[201,409]);
  await pool.query("UPDATE workify.users SET status='BLOCKED',blocked_by=id,blocked_at=now(),block_reason='test' WHERE id=$1",[owner.id]);
  assert.equal((await app.request(`/api/users/${owner.id}/portfolio`)).response.status,404);
  assert.equal((await app.request(`/api/files/${file.id}`)).response.status,404);
  assert.equal((await app.upload(owner.token)).response.status,403);
  await pool.query("UPDATE workify.users SET status='ACTIVE',blocked_by=NULL,blocked_at=NULL,block_reason=NULL,role='ADMIN' WHERE id=$1",[owner.id]);
  assert.equal((await app.request('/api/me/portfolio',options(owner.token))).response.status,403);
  assert.equal((await app.request(`/api/files/${file.id}`)).response.status,404);
  assert.equal((await app.upload(owner.token)).response.status,403);
});
