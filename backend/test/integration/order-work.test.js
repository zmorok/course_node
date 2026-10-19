import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../../src/config/env.js';
import {createDatabasePool} from '../../src/config/database.js';
import {marketplace,future} from '../helpers/marketplace.js';
if(process.env.WORKIFY_DB_TESTS!=='1')throw new Error('Use the disposable infrastructure database');
const config=loadConfig({...process.env,NODE_ENV:'test'}),pool=createDatabasePool(config.database);after(()=>pool.end());
const result={comment:'Результат работы',links:['https://example.org/result']};
async function setup(context,options){const app=await marketplace(context,pool,config,options),customer=await app.register(),freelancer=await app.register();return {...app,customer,freelancer,
  async order(type='proposal'){const project=await app.project(customer,{file:true}),source=type==='proposal'?await app.proposal(freelancer,project):await app.invitation(customer,project,freelancer);const accepted=type==='proposal'?await app.api(customer,`/proposals/${source.id}/accept`,'POST',{}):await app.act(freelancer,source,'accept');assert.equal(accepted.response.status,200);return {...accepted.body[type].order,project};},
  async upload(actor=freelancer){const form=new FormData();form.append('file',new Blob(['Версия результата этапа 12'],{type:'text/plain'}),'Результат.txt');const response=await app.request('/api/files',{method:'POST',headers:{Authorization:`Bearer ${actor.token}`},body:form});assert.equal(response.response.status,201);return response.body.file;},
  async get(id,actor=customer){const response=await app.api(actor,`/orders/${id}`);assert.equal(response.response.status,200);return response.body.order;},
  submit:(order,input=result,actor=freelancer)=>app.api(actor,`/orders/${order.id}/submissions`,'POST',input),
  revision:(order,id,comment='Исправить замечания')=>app.api(customer,`/orders/${order.id}/submissions/${id}/revision`,'POST',{comment}),
  accept:(order,id,actor=customer)=>app.api(actor,`/orders/${order.id}/submissions/${id}/accept`,'POST',{}),
  request:(order,date=future(40),actor=freelancer)=>app.api(actor,`/orders/${order.id}/deadline-requests`,'POST',{proposedDeadlineAt:date,reason:'Нужно согласовать новый срок'}),
  decide:(order,id,kind='approve',body={},actor=customer)=>app.api(actor,`/orders/${order.id}/deadline-requests/${id}/${kind}`,'POST',body),
};}
const history=async(app,order,kind,actor=app.customer,query='')=>(await app.api(actor,`/orders/${order.id}/${kind}${query}`)).body;
const events=async order=>(await pool.query('SELECT event_type,submission_id,deadline_request_id,metadata FROM workify.order_events WHERE order_id=$1 ORDER BY created_at,id',[order.id])).rows;

test('both assignment sources support immutable versions, revisions and atomic acceptance with private files and no payment',async context=>{
  const app=await setup(context);for(const type of ['proposal','invitation']){const order=await app.order(type),file=await app.upload();
    const first=await app.submit(order,{comment:'Первая версия',fileIds:[file.id]});assert.equal(first.response.status,201);assert.equal(first.body.version,1);assert.equal((await app.get(order.id)).status,'SUBMITTED');
    for(const actor of [app.customer,app.freelancer])assert.equal((await app.api(actor,`/files/${file.id}`)).response.status,200);assert.equal((await app.api(null,`/files/${file.id}`)).response.status,404);assert.equal((await app.api(app.freelancer,`/files/${file.id}`,'DELETE')).response.status,409);
    assert.equal((await app.revision(order,first.body.submissionId,'Исправить адаптивность')).response.status,200);assert.equal((await app.get(order.id)).status,'REVISION_REQUESTED');
    const second=await app.submit(order);assert.equal(second.response.status,201);assert.equal(second.body.version,2);assert.equal((await app.accept(order,first.body.submissionId)).response.status,409);
    assert.equal((await app.accept(order,second.body.submissionId)).response.status,200);const done=await app.get(order.id);assert.equal(done.status,'COMPLETED');assert.equal(done.project.status,'COMPLETED');assert(done.completedAt);assert.equal(done.permissions.submit,false);
    const versions=await history(app,order,'submissions');assert.equal(versions.total,2);assert.equal(versions.items[0].status,'ACCEPTED');assert.equal(versions.items[1].reviewComment,'Исправить адаптивность');assert.equal(versions.items[1].comment,'Первая версия');assert.equal(versions.items[1].files[0].id,file.id);assert.equal(versions.items[1].reviewedBy,app.customer.id);
    assert.equal((await app.submit(order)).response.status,409);assert.equal((await app.accept(order,second.body.submissionId)).response.status,409);assert.equal((await app.api(null,`/projects/${order.project.id}`)).response.status,404);
    assert((await events(order)).some(row=>row.event_type==='ORDER_COMPLETED'));assert.equal((await app.api(app.customer,'/me/orders?scope=history')).response.status,200);
  }
});
test('work commands and histories require fresh CLIENT membership and never accept forged status identity version or deadline',async context=>{
  const app=await setup(context),order=await app.order(),other=await app.register();for(const path of ['submissions','deadline-requests']){assert.equal((await app.api(null,`/orders/${order.id}/${path}`)).response.status,401);assert.equal((await app.api(other,`/orders/${order.id}/${path}`)).response.status,404);}
  assert.equal((await app.submit(order,result,app.customer)).response.status,409);assert.equal((await app.submit(order,result,other)).response.status,404);assert.equal((await app.request(order,future(40),app.customer)).response.status,409);
  for(const body of [{comment:'x'},{...result,version:99},{...result,freelancerId:other.id},{...result,status:'COMPLETED'},{...result,fileIds:[randomUUID()]}])assert([422,404].includes((await app.submit(order,body)).response.status));
  await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[app.freelancer.id]);assert.equal((await app.submit(order)).response.status,403);await pool.query("UPDATE workify.users SET role='CLIENT',status='BLOCKED',blocked_by=id,blocked_at=now(),block_reason='test' WHERE id=$1",[app.freelancer.id]);assert.equal((await app.submit(order)).response.status,403);
  await pool.query("UPDATE workify.users SET blocked_at=now()-interval '2 days',blocked_until=now()-interval '1 day' WHERE id=$1",[app.freelancer.id]);assert.equal((await app.submit(order)).response.status,201);
  const submission=(await history(app,order,'submissions')).items[0];assert.equal((await app.accept(order,submission.id,app.freelancer)).response.status,409);assert.equal((await app.api(app.customer,`/orders/${order.id}/submissions/${randomUUID()}/revision`,'POST',{comment:'x'})).response.status,404);
  assert.equal((await app.api(other,`/files/${order.files[0].id}`)).response.status,404);assert.equal((await app.get(order.id)).status,'SUBMITTED');
});
test('submission files reject foreign used and deleted uploads without partial versions; all prior files remain private',async context=>{
  const app=await setup(context),order=await app.order(),foreign=await app.upload(app.customer),deleted=await app.upload();assert.equal((await app.api(app.freelancer,`/files/${deleted.id}`,'DELETE')).response.status,204);
  for(const fileId of [foreign.id,deleted.id,order.files[0].id])assert([404,409].includes((await app.submit(order,{comment:'x',fileIds:[fileId]})).response.status));assert.equal((await history(app,order,'submissions')).total,0);
  const file=await app.upload(),first=await app.submit(order,{comment:'x',fileIds:[file.id]});await app.revision(order,first.body.submissionId);assert.equal((await app.submit(order,{comment:'x',fileIds:[file.id]})).response.status,409);assert.equal((await history(app,order,'submissions')).total,1);
});
test('deadline approval can shorten the future deadline while preserving the initial date and recording decisions events audit and notifications',async context=>{
  const app=await setup(context),order=await app.order(),date=future(10);const request=await app.request(order,date);assert.equal(request.response.status,201);assert.equal((await app.get(order.id)).deadlineAt,order.deadlineAt);
  assert.equal((await app.request(order)).response.status,409);assert.equal((await app.decide(order,request.body.requestId,'approve',{},app.freelancer)).response.status,409);
  assert.equal((await app.decide(order,request.body.requestId)).response.status,200);const updated=await app.get(order.id);assert.equal(updated.deadlineAt,date);assert.equal(updated.initialDeadlineAt,order.initialDeadlineAt);assert.equal(updated.pendingDeadlineRequest,null);
  const rows=(await history(app,order,'deadline-requests')).items;assert.equal(rows[0].status,'APPROVED');assert.equal(rows[0].decidedBy,app.customer.id);assert.equal((await app.decide(order,request.body.requestId)).response.status,409);
  assert.equal((await events(order)).filter(row=>row.event_type==='DEADLINE_APPROVED').length,1);assert.equal((await pool.query("SELECT count(*) FROM workify.audit_logs WHERE entity_id=$1 AND action='DEADLINE_APPROVED'",[order.id])).rows[0].count,'1');assert.equal((await pool.query("SELECT count(*) FROM workify.notifications WHERE order_id=$1 AND event_type='DEADLINE_DECIDED'",[order.id])).rows[0].count,'1');
});
test('deadline rejection requires a reason, leaves the date unchanged and permits a later independent request',async context=>{
  const app=await setup(context),order=await app.order(),request=await app.request(order);assert.equal((await app.decide(order,request.body.requestId,'reject')).response.status,422);assert.equal((await app.decide(order,request.body.requestId,'reject',{reason:'Срок связан с релизом'})).response.status,200);
  assert.equal((await app.get(order.id)).deadlineAt,order.deadlineAt);const record=(await history(app,order,'deadline-requests')).items[0];assert.equal(record.status,'REJECTED');assert.equal(record.decisionReason,'Срок связан с релизом');assert.equal((await app.request(order,future(50))).response.status,201);
  for(const date of [order.deadlineAt,new Date(Date.now()-86400000).toISOString()]){const separate=await app.order();assert.equal((await app.request(separate,date===order.deadlineAt?separate.deadlineAt:date)).response.status,422);assert.equal((await history(app,separate,'deadline-requests')).total,0);}
});
test('submission closes pending deadlines atomically and review/resubmission create independent version and request histories',async context=>{
  const app=await setup(context),order=await app.order(),request=await app.request(order),submitted=await app.submit(order);assert.equal(submitted.response.status,201);assert.equal((await app.decide(order,request.body.requestId)).response.status,409);assert.equal((await app.request(order)).response.status,409);
  let rows=(await history(app,order,'deadline-requests')).items;assert.equal(rows[0].status,'EXPIRED');assert.equal(rows[0].decisionReason,'ORDER_SUBMITTED');assert.equal(rows[0].decidedBy,null);assert.equal((await app.get(order.id)).deadlineAt,order.deadlineAt);
  assert.equal((await app.revision(order,submitted.body.submissionId)).response.status,200);assert.equal((await app.request(order)).response.status,201);rows=(await history(app,order,'deadline-requests')).items;assert.equal(rows.length,2);assert.equal(rows[0].status,'PENDING');assert.equal((await app.submit(order)).body.version,2);assert((await history(app,order,'deadline-requests')).items.every(row=>row.status==='EXPIRED'));
});
test('expired and mismatched pending dates are read without mutations and are closed once before a decision or replacement',async context=>{
  const app=await setup(context),order=await app.order(),request=await app.request(order);await pool.query("UPDATE workify.order_deadline_requests SET created_at=clock_timestamp()-interval '2 days',proposed_deadline_at=clock_timestamp()-interval '1 day' WHERE id=$1",[request.body.requestId]);
  assert.equal((await history(app,order,'deadline-requests')).items[0].isCurrent,false);assert.equal((await app.get(order.id,app.freelancer)).permissions.requestDeadline,true);assert.equal((await history(app,order,'deadline-requests')).items[0].status,'PENDING');
  assert.equal((await app.decide(order,request.body.requestId)).response.status,409);assert.equal((await app.decide(order,request.body.requestId)).response.status,409);assert.equal((await history(app,order,'deadline-requests')).items[0].decisionReason,'TIME_EXPIRED');assert.equal((await events(order)).filter(row=>row.event_type==='DEADLINE_EXPIRED').length,1);
  const next=await app.request(order);assert.equal(next.response.status,201);await pool.query("UPDATE workify.orders SET deadline_at=deadline_at+interval '1 day' WHERE id=$1",[order.id]);const replacement=await app.request(order,future(50));assert.equal(replacement.response.status,201);const records=(await history(app,order,'deadline-requests')).items;assert.equal(records.find(row=>row.id===next.body.requestId).decisionReason,'DEADLINE_CHANGED');
});
test('concurrent submissions requests and reviews serialize to one effect with monotonic versions and coherent completion',async context=>{
  const app=await setup(context),order=await app.order();let responses=await Promise.all([app.request(order),app.request(order)]);assert.deepEqual(responses.map(row=>row.response.status).sort(),[201,409]);
  responses=await Promise.all([app.submit(order),app.submit(order)]);assert.deepEqual(responses.map(row=>row.response.status).sort(),[201,409]);const first=responses.find(row=>row.response.status===201).body.submissionId;
  responses=await Promise.all([app.accept(order,first),app.revision(order,first)]);assert.deepEqual(responses.map(row=>row.response.status).sort(),[200,409]);const current=await app.get(order.id);assert.equal(current.project.status,current.status==='COMPLETED'?'COMPLETED':'IN_PROGRESS');
  if(current.status==='REVISION_REQUESTED'){responses=await Promise.all([app.submit(order),app.submit(order)]);assert.deepEqual(responses.map(row=>row.response.status).sort(),[201,409]);assert.equal(responses.find(row=>row.response.status===201).body.version,2);}
  assert.equal((await events(order)).filter(row=>row.event_type==='SUBMISSION_CREATED').length,(await history(app,order,'submissions')).total);
});
test('submission racing deadline approval produces a valid agreed date or a single expired request, never a late change',async context=>{
  const app=await setup(context),order=await app.order(),date=future(40),request=await app.request(order,date);const [submission,decision]=await Promise.all([app.submit(order),app.decide(order,request.body.requestId)]);assert.equal(submission.response.status,201);assert([200,409].includes(decision.response.status));
  const current=await app.get(order.id),row=(await history(app,order,'deadline-requests')).items[0];assert.equal(current.status,'SUBMITTED');assert.equal(current.deadlineAt,decision.response.status===200?date:order.deadlineAt);assert.equal(row.status,decision.response.status===200?'APPROVED':'EXPIRED');assert.equal((await events(order)).filter(row=>['DEADLINE_APPROVED','DEADLINE_EXPIRED'].includes(row.event_type)).length,1);
});
test('event failures roll back version files pending closure deadline decisions and order/project completion together',async context=>{
  let failure='SUBMISSION_CREATED';const app=await setup(context,{failWorkEvent:type=>type===failure}),order=await app.order(),file=await app.upload(),request=await app.request(order);assert.equal(request.response.status,201);
  assert.equal((await app.submit(order,{comment:'Готово',fileIds:[file.id]})).response.status,500);assert.equal((await app.get(order.id)).status,'IN_PROGRESS');assert.equal((await history(app,order,'submissions')).total,0);assert.equal((await history(app,order,'deadline-requests')).items[0].status,'PENDING');assert.equal((await app.api(app.freelancer,'/files')).body.files.find(row=>row.id===file.id).inUse,false);
  failure='DEADLINE_APPROVED';assert.equal((await app.decide(order,request.body.requestId)).response.status,500);assert.equal((await app.get(order.id)).deadlineAt,order.deadlineAt);assert.equal((await history(app,order,'deadline-requests')).items[0].status,'PENDING');
  failure=null;const submitted=await app.submit(order,{comment:'Готово',fileIds:[file.id]});assert.equal(submitted.response.status,201);failure='ORDER_COMPLETED';assert.equal((await app.accept(order,submitted.body.submissionId)).response.status,500);assert.equal((await app.get(order.id)).status,'SUBMITTED');assert.equal((await app.get(order.id)).project.status,'IN_PROGRESS');assert.equal((await history(app,order,'submissions')).items[0].status,'SUBMITTED');
  failure=null;assert.equal((await app.accept(order,submitted.body.submissionId)).response.status,200);
});
test('histories are privately paginated, immutable and overdue never disables valid work',async context=>{
  const app=await setup(context),order=await app.order();await pool.query("UPDATE workify.orders SET created_at=clock_timestamp()-interval '3 days',deadline_at=clock_timestamp()-interval '1 day' WHERE id=$1",[order.id]);assert.equal((await app.get(order.id)).isOverdue,true);
  const first=await app.submit(order);await app.revision(order,first.body.submissionId);const second=await app.submit(order);const page=await history(app,order,'submissions',app.freelancer,'?pageSize=1&page=2');assert.equal(page.total,2);assert.equal(page.items[0].version,1);assert.equal((await history(app,order,'submissions',app.customer,'?pageSize=1&page=9')).total,2);
  for(const [suffix,method,body] of [[`submissions/${first.body.submissionId}`,'PATCH',{comment:'Переписать'}],[`submissions/${first.body.submissionId}`,'DELETE'],['','PATCH',{deadlineAt:future(90)}]])assert.equal((await app.api(app.customer,`/orders/${order.id}/${suffix}`,method,body)).response.status,404);
  assert.equal((await app.api(app.customer,`/orders/${order.id}/submissions?freelancerId=${app.freelancer.id}`)).response.status,422);assert.equal((await app.accept(order,second.body.submissionId)).response.status,200);assert.equal((await app.get(order.id)).isOverdue,false);
});
test('a role or block change committed while a command waits for user locks is rechecked inside the transaction',async context=>{
  const app=await setup(context),order=await app.order(),client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT id FROM workify.users WHERE id=$1 FOR UPDATE',[app.freelancer.id]);const command=app.submit(order);
    let waiting=false;for(let i=0;i<100;i++){waiting=(await pool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS waiting',[client.processID])).rows[0].waiting;if(waiting)break;await new Promise(resolve=>setTimeout(resolve,10));}assert(waiting,'Command must reach the locked user before changing role');
    await client.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[app.freelancer.id]);await client.query('COMMIT');assert.equal((await command).response.status,403);assert.equal((await history(app,order,'submissions')).total,0);
  }finally{await client.query('ROLLBACK');client.release();}
});
