import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
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
import {createProposalRepository} from '../../src/repositories/proposal.repository.js';
import {createProposalService} from '../../src/services/proposal.service.js';
import {createAssignmentRepository} from '../../src/repositories/assignment.repository.js';
import {createAssignmentService} from '../../src/services/assignment.service.js';
import {createApiRouter} from '../../src/routes/index.js';
import {startApp} from '../helpers/http.js';
if(process.env.WORKIFY_DB_TESTS!=='1')throw new Error('Use the disposable infrastructure database');
const config=loadConfig({...process.env,NODE_ENV:'test'}),pool=createDatabasePool(config.database);
// Immutable audit/order events deliberately survive until the disposable volume is removed.
after(()=>pool.end());
const future=()=>new Date(Date.now()+30*86400000).toISOString();
const options=(token,method='GET',body)=>({method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),'Content-Type':'application/json','X-Workify-Client':'browser'},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function setup(context,{failEvent=()=>false}={}){
  const directory=await mkdtemp(join(tmpdir(),'workify-proposals-'));context.after(()=>rm(directory,{recursive:true,force:true}));
  const fileService=createFileService({repository:createFileRepository(pool),storage:createLocalStorage(directory),transaction:op=>withTransaction(pool,c=>op(createFileRepository(c)))});
  const projectService=createProjectService({repository:createProjectRepository(pool),fileService,transaction:op=>withTransaction(pool,c=>op(createProjectRepository(c),createFileRepository(c)))});
  const proposalService=createProposalService({repository:createProposalRepository(pool),assignmentService:createAssignmentService(),transaction:op=>withTransaction(pool,c=>{
    const assignments=createAssignmentRepository(c),original=assignments.createdEvent;
    assignments.createdEvent=async(...args)=>{if(failEvent())throw new Error('injected event failure');return original(...args);};
    return op(createProposalRepository(c),assignments);
  })});
  const authService=await createAuthService({repository:createAuthRepository(pool),transaction:op=>withTransaction(pool,c=>op(createAuthRepository(c))),accessTokens:createAccessTokens(config.auth),sessionTtlDays:30});
  const app=await startApp(context,createApiRouter({authService,authConfig:config.auth,fileService,projectService,proposalService,healthService:{check:async()=>({status:'ok'})}}));
  const api=(actor,path,method='GET',body)=>app.request(`/api${path}`,options(actor?.token,method,body));
  return {...app,api,async register(){const suffix=randomUUID().replaceAll('-','');const result=await api(null,'/auth/register','POST',{email:`${suffix}@example.invalid`,username:`s_${suffix}`,firstName:'Отклик',lastName:'Тест',password:'proposal test password'});assert.equal(result.response.status,201);return{id:result.body.user.id,token:result.body.accessToken};},
    async project(owner,{file=false,draft=false}={}){
      let fileId;
      if(file){const form=new FormData();form.append('file',new Blob(['Исходное задание'],{type:'text/plain'}),'Задание.txt');const result=await app.request('/api/files',{method:'POST',headers:{Authorization:`Bearer ${owner.token}`},body:form});assert.equal(result.response.status,201);fileId=result.body.file.id;}
      const category=(await api(null,'/categories')).body.categories[0];
      const result=await api(owner,'/projects','POST',{title:`Проект ${randomUUID()}`,description:'Исходное описание задания',categoryId:category.id,budget:'1500.00',fileIds:fileId?[fileId]:[]});assert.equal(result.response.status,201);const project=result.body.project;
      if(!draft)assert.equal((await api(owner,`/projects/${project.id}/publish`,'POST',{})).response.status,200);return{...project,fileId};
    },
    send:(author,project,patch={})=>api(author,`/projects/${project.id}/proposals`,'POST',{message:'Готов выполнить задачу',offeredPrice:'1000.50',offeredDeadlineAt:future(),...patch}),
    async proposal(author,project,patch={}){const result=await this.send(author,project,patch);assert.equal(result.response.status,201,JSON.stringify(result.body));return result.body.proposal;},
    act:(actor,proposal,action,body={})=>api(actor,`/proposals/${proposal.id}/${action}`,'POST',body),
  };
}
async function count(table,projectId){return Number((await pool.query(`SELECT count(*) FROM workify.${table} WHERE project_id=$1`,[projectId])).rows[0].count);}

test('creating a proposal requires an active CLIENT, foreign OPEN project and validated terms; it creates no order',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),project=await app.project(owner);
  assert.equal((await app.send(null,project)).response.status,401);assert.equal((await app.send(owner,project)).response.status,403);
  const draft=await app.project(owner,{draft:true});assert.equal((await app.send(author,draft)).response.status,404);
  for(const patch of [{status:'ACCEPTED'},{freelancerId:owner.id},{customerId:author.id},{message:''},{offeredDeadlineAt:new Date(Date.now()-10000).toISOString()}])assert.equal((await app.send(author,project,patch)).response.status,422);
  const source=await app.proposal(author,project);assert.equal(source.customer.id,owner.id);assert.equal(source.freelancer.id,author.id);assert.equal(source.offeredPrice,'1000.50');assert.equal(source.status,'PENDING');assert.equal(source.order,null);assert.equal(await count('orders',project.id),0);
  assert.equal((await pool.query("SELECT count(*) FROM workify.notifications WHERE proposal_id=$1 AND event_type='PROPOSAL_CREATED'",[source.id])).rows[0].count,'1');
  assert.equal((await pool.query("SELECT count(*) FROM workify.audit_logs WHERE entity_id=$1 AND action='PROPOSAL_CREATED'",[source.id])).rows[0].count,'1');
});

test('concurrent duplicate proposals have one winner; only the author withdraws and can submit again',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),other=await app.register(),project=await app.project(owner);
  const results=await Promise.all([app.send(author,project),app.send(author,project)]);assert.deepEqual(results.map(r=>r.response.status).sort(),[201,409]);const source=results.find(r=>r.response.status===201).body.proposal;
  for(const actor of [owner,other])assert.equal((await app.act(actor,source,'withdraw')).response.status,404);
  assert.equal((await app.act(author,source,'withdraw')).body.proposal.status,'WITHDRAWN');assert.equal((await app.act(author,source,'withdraw')).response.status,409);
  const next=await app.proposal(author,project);assert.notEqual(next.id,source.id);assert.equal(await count('proposals',project.id),2);assert.equal(await count('orders',project.id),0);
});

test('lists and individual proposals are private to parties; owner rejection preserves terms and history',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),other=await app.register(),project=await app.project(owner),source=await app.proposal(author,project);
  assert.equal((await app.api(other,`/projects/${project.id}/proposals`)).response.status,404);assert.equal((await app.api(other,`/proposals/${source.id}`)).response.status,404);
  assert.equal((await app.api(other,'/me/proposals')).body.total,0);assert.equal((await app.api(author,`/me/proposals?projectId=${project.id}`)).body.total,1);
  assert.equal((await app.act(author,source,'reject')).response.status,404);
  const rejected=await app.act(owner,source,'reject',{reason:'Нужен другой стек'});assert.equal(rejected.body.proposal.status,'REJECTED');assert.equal(rejected.body.proposal.closureReason,'Нужен другой стек');assert.equal(rejected.body.proposal.message,source.message);assert.equal(rejected.body.proposal.offeredDeadlineAt,source.offeredDeadlineAt);
  assert.equal((await app.act(owner,source,'accept')).response.status,409);assert.equal((await app.api(author,'/me/proposals?status=REJECTED&pageSize=1&page=2')).body.total,1);
  for(const query of ['freelancerId='+other.id,'status=ACTIVE','page=0','status=PENDING&status=ACCEPTED'])assert.equal((await app.api(author,`/me/proposals?${query}`)).response.status,422);
  const dto=(await app.api(owner,`/projects/${project.id}/proposals`)).body.items[0];for(const key of ['email','phone','password_hash','role','blocked_by'])assert(!JSON.stringify(dto).includes(`"${key}"`));
});

test('acceptance atomically snapshots the order and files, closes all competing sources and persists event, audit and notifications',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),other=await app.register(),project=await app.project(owner,{file:true}),source=await app.proposal(author,project),competitor=await app.proposal(other,project);
  const invitation=(await pool.query("INSERT INTO workify.project_invitations (project_id,customer_id,freelancer_id,message,offered_deadline_at) VALUES ($1,$2,$3,'Invitation',$4) RETURNING id",[project.id,owner.id,author.id,future()])).rows[0].id;
  const result=await app.act(owner,source,'accept');assert.equal(result.response.status,200,JSON.stringify(result.body));const accepted=result.body.proposal,order=accepted.order;
  assert.equal(accepted.status,'ACCEPTED');assert.equal(order.status,'IN_PROGRESS');assert.equal(order.title,project.title);assert.equal(order.description,project.description);assert.equal(order.agreedPrice,'1000.50');assert.equal(order.initialDeadlineAt,source.offeredDeadlineAt);assert.equal(order.files[0].id,project.fileId);
  const stored=(await pool.query('SELECT * FROM workify.orders WHERE id=$1',[order.id])).rows[0];assert.equal(stored.customer_id,owner.id);assert.equal(stored.freelancer_id,author.id);assert.equal(stored.proposal_id,source.id);assert.equal(stored.invitation_id,null);
  assert.equal((await app.api(owner,`/projects/${project.id}`)).body.project.status,'IN_PROGRESS');assert.equal((await app.api(null,`/projects?search=${encodeURIComponent(project.title)}`)).body.total,0);
  const closed=(await app.api(other,`/proposals/${competitor.id}`)).body.proposal;assert.equal(closed.status,'REJECTED');assert.equal(closed.closureReason,'OTHER_SOURCE_ACCEPTED');
  const inv=(await pool.query('SELECT status,closure_reason FROM workify.project_invitations WHERE id=$1',[invitation])).rows[0];assert.equal(inv.status,'EXPIRED');assert.equal(inv.closure_reason,'OTHER_SOURCE_ACCEPTED');
  assert.equal((await pool.query("SELECT count(*) FROM workify.order_events WHERE order_id=$1 AND event_type='ORDER_CREATED'",[order.id])).rows[0].count,'1');assert.equal((await pool.query("SELECT count(*) FROM workify.audit_logs WHERE entity_id=$1 AND action='ORDER_CREATED'",[order.id])).rows[0].count,'1');
  assert.equal((await pool.query("SELECT count(*) FROM workify.notifications WHERE order_id=$1 AND event_type='ORDER_CREATED'",[order.id])).rows[0].count,'2');
  assert.equal((await app.api(author,`/files/${project.fileId}`)).body.toString(),'Исходное задание');for(const actor of [null,other])assert.equal((await app.api(actor,`/files/${project.fileId}`)).response.status,404);
});

test('concurrent acceptance of the same or different sources creates exactly one order and one creation event',async context=>{
  const app=await setup(context),owner=await app.register(),a=await app.register(),b=await app.register();
  for(const same of [false,true]){
    const project=await app.project(owner),first=await app.proposal(a,project),second=same?first:await app.proposal(b,project);
    const results=await Promise.all([app.act(owner,first,'accept'),app.act(owner,second,'accept')]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);assert.equal(await count('orders',project.id),1);
    assert.equal((await pool.query('SELECT count(*) FROM workify.order_events e JOIN workify.orders o ON o.id=e.order_id WHERE o.project_id=$1',[project.id])).rows[0].count,'1');
    const before=Number((await pool.query('SELECT count(*) FROM workify.notifications WHERE project_id=$1',[project.id])).rows[0].count);assert.equal((await app.act(owner,first,'accept')).response.status,409);assert.equal(await count('notifications',project.id),before);
  }
});

test('an event failure rolls back source, order, project, closed alternatives, audit and notifications',async context=>{
  let failing=true;const app=await setup(context,{failEvent:()=>failing}),owner=await app.register(),a=await app.register(),b=await app.register(),project=await app.project(owner,{file:true}),first=await app.proposal(a,project),second=await app.proposal(b,project);
  const notifications=await count('notifications',project.id),audit=Number((await pool.query('SELECT count(*) FROM workify.audit_logs WHERE entity_id=ANY($1::uuid[])',[ [first.id,second.id] ])).rows[0].count);
  assert.equal((await app.act(owner,first,'accept')).response.status,500);assert.equal(await count('orders',project.id),0);assert.equal(await count('notifications',project.id),notifications);
  assert.equal((await app.api(owner,`/projects/${project.id}`)).body.project.status,'OPEN');for(const source of [first,second])assert.equal((await app.api(owner,`/proposals/${source.id}`)).body.proposal.status,'PENDING');
  assert.equal(Number((await pool.query('SELECT count(*) FROM workify.audit_logs WHERE entity_id=ANY($1::uuid[])',[[first.id,second.id]])).rows[0].count),audit);
  failing=false;assert.equal((await app.act(owner,first,'accept')).response.status,200);
});

test('expired terms are rejected and committed before the error, repeated calls have no duplicate effects and a new proposal is possible',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),project=await app.project(owner),source=await app.proposal(author,project);
  await pool.query("UPDATE workify.proposals SET created_at=now()-interval '2 days',offered_deadline_at=now()-interval '1 day' WHERE id=$1",[source.id]);
  const pending=(await app.api(owner,`/proposals/${source.id}`)).body.proposal;assert.equal(pending.expired,true);assert.equal(pending.canDecide,false);
  const expired=await app.act(owner,source,'accept');assert.equal(expired.response.status,409);assert.equal(expired.body.error.code,'PROPOSAL_EXPIRED');
  const row=(await pool.query('SELECT status,closure_reason FROM workify.proposals WHERE id=$1',[source.id])).rows[0];assert.equal(row.status,'REJECTED');assert.equal(row.closure_reason,'TERMS_EXPIRED');assert.equal(await count('orders',project.id),0);
  const notifications=await count('notifications',project.id);assert.equal((await app.act(owner,source,'accept')).response.status,409);assert.equal(await count('notifications',project.id),notifications);
  assert.equal((await app.proposal(author,project)).status,'PENDING');
});

test('new and existing sessions respect role/block changes; unavailable counterpart errors never identify the actor as blocked',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),project=await app.project(owner),source=await app.proposal(author,project);
  await pool.query("UPDATE workify.users SET status='BLOCKED',blocked_by=id,blocked_at=now(),block_reason='test' WHERE id=$1",[author.id]);
  assert.equal((await app.api(author,'/me/proposals')).response.status,403);const unavailable=await app.act(owner,source,'accept');assert.equal(unavailable.body.error.code,'COUNTERPARTY_UNAVAILABLE');assert.equal(await count('orders',project.id),0);
  await pool.query("UPDATE workify.users SET blocked_at=now()-interval '2 days',blocked_until=now()-interval '1 day' WHERE id=$1",[author.id]);assert.equal((await app.act(owner,source,'accept')).response.status,200);
  await pool.query("UPDATE workify.users SET status='ACTIVE',blocked_by=NULL,blocked_at=NULL,blocked_until=NULL,block_reason=NULL,role='ADMIN' WHERE id=$1",[author.id]);assert.equal((await app.api(author,'/me/proposals')).response.status,403);
});

test('acceptance racing with project editing or cancellation has one coherent outcome and no partial assignment',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register();
  for(const action of ['edit','cancel']){
    const project=await app.project(owner),source=await app.proposal(author,project);
    const results=await Promise.all([app.act(owner,source,'accept'),action==='edit'?app.api(owner,`/projects/${project.id}`,'PATCH',{title:'Новые условия'}):app.api(owner,`/projects/${project.id}/cancel`,'POST',{reason:'Отмена'})]);
    assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);const current=(await app.api(owner,`/projects/${project.id}`)).body.project,proposal=(await app.api(owner,`/proposals/${source.id}`)).body.proposal;
    if(current.status==='IN_PROGRESS'){assert.equal(proposal.status,'ACCEPTED');assert.equal(await count('orders',project.id),1);assert.equal(proposal.order.title,project.title);}
    else{assert.equal(current.status,action==='edit'?'OPEN':'CANCELLED');assert.equal(proposal.status,'REJECTED');assert.equal(await count('orders',project.id),0);}
  }
});

test('withdrawal racing acceptance cannot leave an accepted withdrawn source or a second order',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),project=await app.project(owner),source=await app.proposal(author,project);
  const results=await Promise.all([app.act(owner,source,'accept'),app.act(author,source,'withdraw')]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);
  const current=(await app.api(owner,`/proposals/${source.id}`)).body.proposal;assert(['ACCEPTED','WITHDRAWN'].includes(current.status));assert.equal(await count('orders',project.id),current.status==='ACCEPTED'?1:0);
});

test('accepted agreement and file snapshot remain available to parties after a later project edit without exposing them to others',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),other=await app.register(),project=await app.project(owner,{file:true}),source=await app.proposal(author,project),accepted=(await app.act(owner,source,'accept')).body.proposal;
  await withTransaction(pool,async c=>{await c.query("UPDATE workify.orders SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=customer_id,cancellation_reason='Fixture cancellation' WHERE id=$1",[accepted.order.id]);await c.query("UPDATE workify.projects SET status='OPEN' WHERE id=$1",[project.id]);});
  assert.equal((await app.api(owner,`/projects/${project.id}`,'PATCH',{title:'Новое задание',description:'Другое описание',fileIds:[]})).response.status,200);
  const history=(await app.api(author,`/proposals/${source.id}`)).body.proposal;assert.equal(history.status,'ACCEPTED');assert.equal(history.order.title,project.title);assert.equal(history.order.description,project.description);assert.equal(history.order.files[0].id,project.fileId);
  assert.equal((await app.api(author,`/files/${project.fileId}`)).response.status,200);for(const actor of [null,other])assert.equal((await app.api(actor,`/files/${project.fileId}`)).response.status,404);
  assert.equal((await app.api(owner,`/files/${project.fileId}`,'DELETE')).response.status,409);
});
