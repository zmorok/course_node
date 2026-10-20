import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadConfig} from '../../src/config/env.js';
import {createDatabasePool} from '../../src/config/database.js';
import {withTransaction} from '../../src/repositories/transaction.js';
import {createAuthRepository} from '../../src/repositories/auth.repository.js';
import {createAuthService} from '../../src/services/auth.service.js';
import {createAccessTokens} from '../../src/utils/tokens.js';
import {createFileRepository} from '../../src/repositories/file.repository.js';
import {createFileService} from '../../src/services/file.service.js';
import {createLocalStorage} from '../../src/storage/local-storage.js';
import {createProjectRepository} from '../../src/repositories/project.repository.js';
import {createProjectService} from '../../src/services/project.service.js';
import {createApiRouter} from '../../src/routes/index.js';
import {startApp} from '../helpers/http.js';
if(process.env.WORKIFY_DB_TESTS!=='1')throw new Error('Use the disposable infrastructure test database');
const config=loadConfig({...process.env,NODE_ENV:'test'}),pool=createDatabasePool(config.database),owned=[];
// Immutable audit keeps its actors until the disposable database is removed.
after(()=>pool.end());
const options=(token,method='GET',body)=>({method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json','X-Workify-Client':'browser'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const future=()=>new Date(Date.now()+30*86400000).toISOString();
async function setup(context){
  const directory=await mkdtemp(join(tmpdir(),'workify-projects-'));context.after(()=>rm(directory,{recursive:true,force:true}));
  const fileService=createFileService({repository:createFileRepository(pool),storage:createLocalStorage(directory),transaction:op=>withTransaction(pool,c=>op(createFileRepository(c)))});
  const projectService=createProjectService({repository:createProjectRepository(pool),fileService,transaction:op=>withTransaction(pool,c=>op(createProjectRepository(c),createFileRepository(c)))});
  const authService=await createAuthService({repository:createAuthRepository(pool),transaction:op=>withTransaction(pool,c=>op(createAuthRepository(c))),accessTokens:createAccessTokens(config.auth),sessionTtlDays:30});
  const app=await startApp(context,createApiRouter({authService,authConfig:config.auth,fileService,projectService,healthService:{check:async()=>({status:'ok'})}}));
  const categories=(await app.request('/api/categories')).body.categories,skills=(await pool.query('SELECT id,slug FROM workify.skills ORDER BY slug')).rows;
  const api=(token,path,method='GET',body)=>app.request(`/api${path}`,options(token,method,body));
  return {...app,api,directory,categories,skills,async register(){
    const suffix=randomUUID().replaceAll('-','');
    const result=await api(null,'/auth/register','POST',{email:`${suffix}@example.invalid`,username:`proj_${suffix}`,firstName:'Проект',lastName:'Тест',password:'project test password'});
    assert.equal(result.response.status,201);owned.push(result.body.user.id);return{id:result.body.user.id,token:result.body.accessToken};
  },async create(actor,patch={}){
    const result=await api(actor.token,'/projects','POST',{title:`Проект ${randomUUID()}`,description:'Задание\nдля команды',categoryId:categories[0].id,...patch});
    assert.equal(result.response.status,201,JSON.stringify(result.body));return result.body.project;
  },async publish(actor,id){const result=await api(actor.token,`/projects/${id}/publish`,'POST',{});assert.equal(result.response.status,200,JSON.stringify(result.body));return result.body.project;},
  async upload(actor){const form=new FormData();form.append('file',new Blob(['Файл проекта'],{type:'text/plain'}),'Задание.txt');
    const result=await app.request('/api/files',{method:'POST',headers:{Authorization:`Bearer ${actor.token}`},body:form});assert.equal(result.response.status,201);return result.body.file;},
  async pending(project,freelancer){
    const proposal=(await pool.query(`INSERT INTO workify.proposals (project_id,customer_id,freelancer_id,message,offered_deadline_at) VALUES ($1,$2,$3,'Предложение',$4) RETURNING id`,[project.id,project.customer.id,freelancer.id,future()])).rows[0].id;
    const invitation=(await pool.query(`INSERT INTO workify.project_invitations (project_id,customer_id,freelancer_id,message,offered_deadline_at) VALUES ($1,$2,$3,'Приглашение',$4) RETURNING id`,[project.id,project.customer.id,freelancer.id,future()])).rows[0].id;
    return{proposal,invitation};
  }};
}

test('projects require CLIENT ownership and drafts never disclose private data to another user',async context=>{
  const app=await setup(context),owner=await app.register(),other=await app.register();
  assert.equal(app.categories.length,8);assert.equal((await app.api(null,'/projects','POST',{title:'X'})).response.status,401);
  for(const extra of [{customerId:other.id},{status:'OPEN'},{createdAt:future()}])assert.equal((await app.api(owner.token,'/projects','POST',{title:'X',...extra})).response.status,422);
  const draft=await app.create(owner,{budget:'123.40',skillIds:[app.skills[0].id]});assert.equal(draft.status,'DRAFT');assert.equal(draft.isOwn,true);assert.equal(draft.budget,'123.40');
  for(const token of [null,other.token])assert.equal((await app.api(token,`/projects/${draft.id}`)).response.status,404);
  for(const method of ['PATCH','DELETE'])assert.equal((await app.api(other.token,`/projects/${draft.id}`,method,method==='PATCH'?{title:'Hacked'}:undefined)).response.status,404);
  assert.equal((await app.api(other.token,`/projects/${draft.id}/publish`,'POST',{})).response.status,404);
  assert.equal((await app.api(other.token,'/me/projects')).body.total,0);
  const own=(await app.api(owner.token,'/me/projects')).body.items[0];assert.equal(own.skills[0].id,app.skills[0].id);
  for(const key of ['email','phone','password_hash','role','blocked_by'])assert(!JSON.stringify(own).includes(`"${key}"`));
});

test('publication validates required fields and a future desired deadline; OPEN is public and owned flags come from the server',async context=>{
  const app=await setup(context),owner=await app.register(),other=await app.register();
  const draft=await app.create(owner,{description:'',categoryId:null});
  assert.equal((await app.api(owner.token,`/projects/${draft.id}/publish`,'POST',{})).response.status,422);
  assert.equal((await app.api(owner.token,`/projects/${draft.id}`,'PATCH',{description:'Готово',categoryId:app.categories[0].id,desiredDeadlineAt:future()})).response.status,200);
  await app.publish(owner,draft.id);
  assert.equal((await app.api(owner.token,`/projects/${draft.id}/publish`,'POST',{})).response.status,409);
  const guest=(await app.api(null,`/projects/${draft.id}`)).body.project;assert.equal(guest.isOwn,false);assert.equal(guest.acceptsProposals,true);
  const ownCatalog=(await app.api(owner.token,`/projects?search=${encodeURIComponent(draft.title)}`)).body;assert.equal(ownCatalog.items[0].isOwn,true);
  assert.equal((await app.api(other.token,`/projects/${draft.id}`)).body.project.isOwn,false);
  assert.equal((await app.api(owner.token,`/projects/${draft.id}`,'DELETE')).response.status,409);
  assert.equal((await app.api(owner.token,`/projects/${draft.id}`,'PATCH',{description:''})).response.status,422);
  const expired=await app.create(owner);await pool.query("UPDATE workify.projects SET created_at=now()-interval '2 days',desired_deadline_at=now()-interval '1 day' WHERE id=$1",[expired.id]);
  assert.equal((await app.api(owner.token,`/projects/${expired.id}/publish`,'POST',{})).response.status,422);
});

test('partial edits preserve omitted fields and reject unknown catalog references atomically; only drafts can be physically deleted',async context=>{
  const app=await setup(context),owner=await app.register();const file=await app.upload(owner);
  const draft=await app.create(owner,{budget:'250.50',fileIds:[file.id],skillIds:[app.skills[0].id]});
  const saved=await app.api(owner.token,`/projects/${draft.id}`,'PATCH',{title:'Новое название'});assert.equal(saved.response.status,200);assert.equal(saved.body.project.budget,'250.50');assert.equal(saved.body.project.files.length,1);
  for(const patch of [{categoryId:randomUUID()},{skillIds:[randomUUID()]},{fileIds:[randomUUID()]}]){
    assert([404,422].includes((await app.api(owner.token,`/projects/${draft.id}`,'PATCH',{title:'Не сохранять',...patch})).response.status));
    assert.equal((await app.api(owner.token,`/projects/${draft.id}`)).body.project.title,'Новое название');
  }
  assert.equal((await app.api(owner.token,`/projects/${draft.id}`,'DELETE')).response.status,204);assert.equal((await app.api(owner.token,`/files/${file.id}`)).response.status,404);assert.deepEqual(await readdir(app.directory),[]);
});

test('catalog search, category, skill, budget, stable sort and pagination are applied by PostgreSQL',async context=>{
  const app=await setup(context),owner=await app.register(),tag=randomUUID();
  const projects=[];
  for(const [index,budget] of [null,'100.00','250.00'].entries()){
    const project=await app.create(owner,{title:`${tag} ${index===0?'100%_literal':'API'} ${index}`,budget,categoryId:app.categories[index===2?1:0].id,skillIds:index===1?[app.skills[0].id]:[]});await app.publish(owner,project.id);projects.push(project);
  }
  await app.create(owner,{title:`${tag} hidden draft`});
  const read=async query=>(await app.api(null,`/projects?search=${tag}&${query}`)).body;
  const sorted=await read('sort=budget_desc');assert.equal(sorted.total,3);assert.deepEqual(sorted.items.map(p=>p.id),[projects[2].id,projects[1].id,projects[0].id]);assert.equal(sorted.items[1].budget,'100.00');
  assert.deepEqual((await read('minBudget=100&maxBudget=200')).items.map(p=>p.id),[projects[1].id]);
  assert.equal((await read(`category=${app.categories[0].slug}`)).total,2);assert.equal((await read(`skill=${app.skills[0].slug}`)).total,1);
  assert.equal((await read('category=nonexistent-category')).total,0);
  const page=await read('page=2&pageSize=1&sort=budget_desc');assert.equal(page.total,3);assert.equal(page.items[0].id,projects[1].id);
  const beyond=await read('page=10&pageSize=1');assert.equal(beyond.total,3);assert.deepEqual(beyond.items,[]);
  assert.equal((await app.api(null,`/projects?search=${encodeURIComponent(`${tag} 100%_literal`)}`)).body.total,1);
  for(const query of ['status=DRAFT','page=0','sort=id;drop','search=a&search=b','minBudget=300&maxBudget=100'])assert.equal((await app.api(null,`/projects?${query}`)).response.status,422);
  assert.equal((await app.api(owner.token,`/me/projects?status=DRAFT&search=${tag}`)).body.total,1);
});

test('editing OPEN terms closes pending sources only on real changes; final cancellation preserves history and closes new pending sources',async context=>{
  const app=await setup(context),owner=await app.register(),other=await app.register(),project=await app.create(owner);await app.publish(owner,project.id);
  const pending=await app.pending(project,other);
  assert.equal((await app.api(owner.token,`/projects/${project.id}`,'PATCH',{title:project.title})).response.status,200);
  assert.equal((await pool.query('SELECT status FROM workify.proposals WHERE id=$1',[pending.proposal])).rows[0].status,'PENDING');
  await app.api(owner.token,`/projects/${project.id}`,'PATCH',{budget:'500.00'});
  for(const [table,id,status] of [['proposals',pending.proposal,'REJECTED'],['project_invitations',pending.invitation,'EXPIRED']]){
    const row=(await pool.query(`SELECT status,closure_reason,decided_at FROM workify.${table} WHERE id=$1`,[id])).rows[0];assert.equal(row.status,status);assert.equal(row.closure_reason,'TERMS_CHANGED');assert(row.decided_at);
  }
  const next=await app.pending(project,other);
  assert.equal((await app.api(owner.token,`/projects/${project.id}/cancel`,'POST',{reason:' ' })).response.status,422);
  const cancelled=await app.api(owner.token,`/projects/${project.id}/cancel`,'POST',{reason:'Задание больше не требуется'});assert.equal(cancelled.body.project.status,'CANCELLED');assert.equal(cancelled.body.project.acceptsProposals,false);
  assert.equal((await pool.query('SELECT closure_reason FROM workify.proposals WHERE id=$1',[next.proposal])).rows[0].closure_reason,'PROJECT_CANCELLED');
  for(const action of ['publish','cancel'])assert.equal((await app.api(owner.token,`/projects/${project.id}/${action}`,'POST',action==='cancel'?{reason:'Повтор'}:{})).response.status,409);
  assert.equal((await app.api(owner.token,`/projects/${project.id}`,'DELETE')).response.status,409);assert.equal((await app.api(null,`/projects/${project.id}`)).response.status,404);
});

test('COMPLETED and IN_PROGRESS projects cannot be edited, republished or offered as new work',async context=>{
  const app=await setup(context),owner=await app.register();
  for(const status of ['COMPLETED','IN_PROGRESS']){
    const project=await app.create(owner);await app.publish(owner,project.id);
    await pool.query("UPDATE workify.projects SET status=$2::varchar,completed_at=CASE WHEN $2::varchar='COMPLETED' THEN clock_timestamp() ELSE NULL END WHERE id=$1",[project.id,status]);
    const own=(await app.api(owner.token,`/projects/${project.id}`)).body.project;assert.equal(own.acceptsProposals,false);
    for(const [method,path,body] of [['PATCH','',{title:'Changed'}],['DELETE','',undefined],['POST','/publish',{}],['POST','/cancel',{reason:'Cancel'}]])assert.equal((await app.api(owner.token,`/projects/${project.id}${path}`,method,body)).response.status,409);
    assert.equal((await app.api(null,`/projects?search=${encodeURIComponent(project.title)}`)).body.total,0);assert.equal((await app.api(null,`/projects/${project.id}`)).response.status,404);
  }
});

test('project attachments stay private in drafts, become public in OPEN, reject foreign files and clean up detached objects',async context=>{
  const app=await setup(context),owner=await app.register(),other=await app.register(),project=await app.create(owner),file=await app.upload(owner),foreign=await app.upload(other);
  assert.equal((await app.api(other.token,`/projects/${project.id}/files`,'POST',{fileId:foreign.id})).response.status,404);
  assert.equal((await app.api(owner.token,`/projects/${project.id}/files`,'POST',{fileId:foreign.id})).response.status,404);
  assert.equal((await app.api(owner.token,`/projects/${project.id}/files`,'POST',{fileId:file.id})).response.status,200);
  assert.equal((await app.api(null,`/files/${file.id}`)).response.status,404);await app.publish(owner,project.id);
  assert.equal((await app.api(null,`/files/${file.id}`)).body.toString(),'Файл проекта');
  assert.equal((await app.api(owner.token,`/files/${file.id}`,'DELETE')).response.status,409);
  assert.equal((await app.api(other.token,`/projects/${project.id}/files/${file.id}`,'DELETE')).response.status,404);
  assert.equal((await app.api(owner.token,`/projects/${project.id}/files/${file.id}`,'DELETE')).response.status,200);
  assert.equal((await app.api(null,`/files/${file.id}`)).response.status,404);
  const privateFile=await app.upload(owner);await app.api(owner.token,`/projects/${project.id}/files`,'POST',{fileId:privateFile.id});
  await app.api(owner.token,`/projects/${project.id}/cancel`,'POST',{reason:'Отмена'});
  assert.equal((await app.api(null,`/files/${privateFile.id}`)).response.status,404);assert.equal((await app.api(owner.token,`/files/${privateFile.id}`)).response.status,200);
});

test('concurrent edits preserve independent fields, double publish has one winner and role/block changes immediately remove access',async context=>{
  const app=await setup(context),owner=await app.register(),project=await app.create(owner);
  const edits=await Promise.all([app.api(owner.token,`/projects/${project.id}`,'PATCH',{title:'Concurrent title'}),app.api(owner.token,`/projects/${project.id}`,'PATCH',{budget:'77.00'})]);assert(edits.every(r=>r.response.status===200));
  const saved=(await app.api(owner.token,`/projects/${project.id}`)).body.project;assert.equal(saved.title,'Concurrent title');assert.equal(saved.budget,'77.00');
  const published=await Promise.all([1,2].map(()=>app.api(owner.token,`/projects/${project.id}/publish`,'POST',{})));assert.deepEqual(published.map(r=>r.response.status).sort(),[200,409]);
  await pool.query("UPDATE workify.users SET status='BLOCKED',blocked_by=id,blocked_at=now(),block_reason='test' WHERE id=$1",[owner.id]);
  assert.equal((await app.api(owner.token,'/me/projects')).response.status,403);assert.equal((await app.api(null,`/projects/${project.id}`)).response.status,404);
  await pool.query("UPDATE workify.users SET status='ACTIVE',blocked_by=NULL,blocked_at=NULL,block_reason=NULL,role='ADMIN' WHERE id=$1",[owner.id]);
  assert.equal((await app.api(owner.token,'/projects','POST',{title:'Admin project'})).response.status,403);assert.equal((await app.api(null,`/projects/${project.id}`)).response.status,404);
});
