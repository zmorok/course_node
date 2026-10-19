import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../../src/config/env.js';
import {createDatabasePool} from '../../src/config/database.js';
import {marketplace} from '../helpers/marketplace.js';
if(process.env.WORKIFY_DB_TESTS!=='1')throw new Error('Use the disposable infrastructure database');
const config=loadConfig({...process.env,NODE_ENV:'test'}),pool=createDatabasePool(config.database);after(()=>pool.end());
const setup=context=>marketplace(context,pool,config);
async function createOrder(app,customer,freelancer,{type='proposal',file=false,project}={}){
  project??=await app.project(customer,{file});const source=type==='proposal'?await app.proposal(freelancer,project):await app.invitation(customer,project,freelancer);
  const accepted=type==='proposal'?await app.api(customer,`/proposals/${source.id}/accept`,'POST',{}):await app.act(freelancer,source,'accept');assert.equal(accepted.response.status,200);
  return {...accepted.body[type].order,project,source,type,customer,freelancer};
}
// Later lifecycle commands belong to stages 12/13. These isolated SQL fixtures
// exercise every existing schema state without exposing arbitrary-status API.
async function state(order,status){
  if(['SUBMITTED','REVISION_REQUESTED','COMPLETED'].includes(status))await pool.query(`INSERT INTO workify.order_submissions(order_id,freelancer_id,version,comment,status,reviewed_by,reviewed_at,review_comment)
    VALUES($1,$2,1,'Тестовая версия',$3::varchar,$4,CASE WHEN $3::varchar='SUBMITTED' THEN NULL ELSE clock_timestamp() END,$5)`,[order.id,order.freelancer.id,status==='COMPLETED'?'ACCEPTED':status,status==='SUBMITTED'?null:order.customer.id,status==='REVISION_REQUESTED'?'Исправить замечания':null]);
  if(status==='COMPLETED'){await pool.query("UPDATE workify.orders SET status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",[order.id]);await pool.query("UPDATE workify.projects SET status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",[order.project.id]);}
  else if(status==='CANCELLED'){await pool.query("UPDATE workify.orders SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=$2,cancellation_reason='Тестовая отмена' WHERE id=$1",[order.id,order.customer.id]);await pool.query("UPDATE workify.projects SET status='OPEN' WHERE id=$1",[order.project.id]);}
  else await pool.query('UPDATE workify.orders SET status=$2 WHERE id=$1',[order.id,status]);
}

test('orders require a current CLIENT session and private membership, including role block and logout changes',async context=>{
  const app=await setup(context),a=await app.register(),b=await app.register(),other=await app.register(),order=await createOrder(app,a,b);
  for(const path of ['/me/orders',`/orders/${order.id}`])assert.equal((await app.api(null,path)).response.status,401);
  const foreign=await app.api(other,`/orders/${order.id}`),missing=await app.api(other,`/orders/${randomUUID()}`);assert.equal(foreign.response.status,404);assert.equal(foreign.body.error.code,missing.body.error.code);
  await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[other.id]);assert.equal((await app.api(other,'/me/orders')).response.status,403);
  await pool.query("UPDATE workify.users SET status='BLOCKED',blocked_by=id,blocked_at=now(),block_reason='test' WHERE id=$1",[a.id]);assert.equal((await app.api(a,`/orders/${order.id}`)).response.status,403);assert.equal((await app.api(b,`/orders/${order.id}`)).response.status,200);
  await pool.query("UPDATE workify.users SET blocked_at=now()-interval '2 days',blocked_until=now()-interval '1 day' WHERE id=$1",[a.id]);assert.equal((await app.api(a,'/me/orders')).response.status,200);
  await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[a.id]);assert.equal((await app.api(a,`/orders/${order.id}`)).response.status,403);
  await pool.query('UPDATE workify.auth_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1',[b.id]);assert.equal((await app.api(b,`/orders/${order.id}`)).response.status,401);
});

test('the same CLIENT sees separate customer and freelancer modes with active and history statuses from both source types',async context=>{
  const app=await setup(context),a=await app.register(),b=await app.register();const expected={customer:{active:[],history:[]},freelancer:{active:[],history:[]}};
  for(const mode of ['customer','freelancer'])for(const status of ['IN_PROGRESS','SUBMITTED','REVISION_REQUESTED','COMPLETED','CANCELLED']){const order=await createOrder(app,mode==='customer'?a:b,mode==='customer'?b:a,{type:mode==='customer'?'proposal':'invitation'});await state(order,status);expected[mode][['COMPLETED','CANCELLED'].includes(status)?'history':'active'].push(order.id);}
  for(const mode of ['customer','freelancer'])for(const scope of ['active','history']){const result=await app.api(a,`/me/orders?mode=${mode}&scope=${scope}`);assert.equal(result.response.status,200);assert.equal(result.body.total,expected[mode][scope].length);assert.deepEqual(result.body.items.map(row=>row.id).sort(),expected[mode][scope].sort());assert(result.body.items.every(row=>row.participantMode===mode));}
  assert.equal((await app.api(a,'/me/orders')).body.total,3);const submitted=(await app.api(a,'/me/orders?mode=freelancer&status=SUBMITTED')).body;assert.equal(submitted.total,1);assert.equal(submitted.items[0].status,'SUBMITTED');assert.equal(submitted.items[0].source.type,'invitation');
});

test('server pagination keeps total outside the last page and uses stable creation and terminal-time ordering',async context=>{
  const app=await setup(context),a=await app.register(),b=await app.register(),orders=[];for(let i=0;i<3;i++)orders.push(await createOrder(app,a,b));
  await pool.query("UPDATE workify.orders SET created_at='2020-01-01T00:00:00Z' WHERE id=ANY($1::uuid[])",[orders.map(order=>order.id)]);
  const expected=orders.map(order=>order.id).sort().reverse(),seen=[];for(let page=1;page<=3;page++){const result=(await app.api(a,`/me/orders?pageSize=1&page=${page}`)).body;assert.equal(result.total,3);seen.push(result.items[0].id);}assert.deepEqual(seen,expected);
  const beyond=(await app.api(a,'/me/orders?page=10&pageSize=1')).body;assert.equal(beyond.total,3);assert.deepEqual(beyond.items,[]);
  await state(orders[0],'COMPLETED');await state(orders[1],'CANCELLED');await pool.query("UPDATE workify.orders SET completed_at=clock_timestamp()-interval '1 day' WHERE id=$1",[orders[0].id]);
  const history=(await app.api(a,'/me/orders?scope=history')).body;assert.deepEqual(history.items.map(row=>row.id),[orders[1].id,orders[0].id]);
  for(const query of ['customerId='+b.id,'freelancerId='+b.id,'mode=admin','scope=all','page=0','pageSize=25','scope=active&status=COMPLETED','scope=history&status=SUBMITTED','mode=customer&mode=freelancer'])assert.equal((await app.api(a,`/me/orders?${query}`)).response.status,422);
});

test('details expose immutable agreement and participant-only files from proposal and invitation, never current private project terms or contacts',async context=>{
  const app=await setup(context),a=await app.register(),b=await app.register(),other=await app.register();
  for(const type of ['proposal','invitation']){const order=await createOrder(app,a,b,{type,file:true});await state(order,'CANCELLED');assert.equal((await app.api(a,`/projects/${order.project.id}`,'PATCH',{title:'Новое задание',description:'Новое закрытое соглашение',fileIds:[]})).response.status,200);
    for(const actor of [a,b]){const result=await app.api(actor,`/orders/${order.id}`);assert.equal(result.response.status,200);assert.equal(result.response.headers.get('cache-control'),'no-store');const dto=result.body.order;
      assert.equal(dto.title,order.project.title);assert.equal(dto.description,order.project.description);assert.equal(dto.agreedPrice,type==='proposal'?'2000.00':'2400.50');assert.equal(dto.source.type,type);assert.equal(dto.source.id,order.source.id);assert.equal(dto.files[0].id,order.project.fileId);assert.equal(dto.participantMode,actor===a?'customer':'freelancer');assert.equal(dto.cancellationReason,'Тестовая отмена');assert.equal(dto.permissions.cancel,false);
      for(const key of ['email','phone','password_hash','role','blocked_until','storageKey'])assert(!JSON.stringify(dto).includes(`"${key}"`));assert(!Object.hasOwn(dto.project,'title'));assert.equal((await app.api(actor,`/files/${order.project.fileId}`)).response.status,200);}
    for(const actor of [other,null])assert.equal((await app.api(actor,`/files/${order.project.fileId}`)).response.status,404);
  }
});

test('detail permissions use the latest submission and current pending deadline from one database snapshot',async context=>{
  const app=await setup(context),a=await app.register(),b=await app.register(),order=await createOrder(app,a,b);const get=async actor=>(await app.api(actor,`/orders/${order.id}`)).body.order;
  assert.equal((await get(a)).permissions.cancel,true);assert.equal((await get(a)).permissions.acceptSubmission,false);assert.equal((await get(b)).permissions.submit,true);assert.equal((await get(b)).permissions.requestDeadline,true);
  const request=(await pool.query("INSERT INTO workify.order_deadline_requests(order_id,freelancer_id,previous_deadline_at,proposed_deadline_at,reason) SELECT id,freelancer_id,deadline_at,deadline_at+interval '1 day','Нужен дополнительный день' FROM workify.orders WHERE id=$1 RETURNING id",[order.id])).rows[0];
  assert.equal((await get(a)).permissions.approveDeadline,true);assert.equal((await get(b)).permissions.requestDeadline,false);
  await pool.query("UPDATE workify.order_deadline_requests SET created_at=clock_timestamp()-interval '2 days',proposed_deadline_at=clock_timestamp()-interval '1 day' WHERE id=$1",[request.id]);assert.equal((await get(a)).permissions.approveDeadline,false);assert.equal((await get(b)).permissions.requestDeadline,true);assert.equal((await get(b)).pendingDeadlineRequest.isCurrent,false);
  assert.equal((await pool.query('SELECT status FROM workify.order_deadline_requests WHERE id=$1',[request.id])).rows[0].status,'PENDING');
  await state(order,'SUBMITTED');const latest=(await pool.query("INSERT INTO workify.order_submissions(order_id,freelancer_id,version,comment,status,reviewed_by,reviewed_at,review_comment) VALUES($1,$2,2,'Последняя версия','REVISION_REQUESTED',$3,clock_timestamp(),'Замечания') RETURNING id",[order.id,b.id,a.id])).rows[0];
  assert.equal((await get(a)).lastSubmission.id,latest.id);assert.equal((await get(a)).permissions.acceptSubmission,false);
  await pool.query("UPDATE workify.order_submissions SET status='CANCELLED' WHERE order_id=$1 AND version=1",[order.id]);await pool.query("UPDATE workify.order_submissions SET status='SUBMITTED',reviewed_by=NULL,reviewed_at=NULL,review_comment=NULL WHERE id=$1",[latest.id]);
  assert.equal((await get(a)).permissions.acceptSubmission,true);assert.equal((await get(a)).permissions.requestRevision,true);assert.equal((await get(b)).permissions.submit,false);assert.equal((await get(a)).permissions.approveDeadline,false);
});

test('overdue is computed on the server for active orders only and reads never transition state or create events',async context=>{
  const app=await setup(context),a=await app.register(),b=await app.register();
  for(const status of ['IN_PROGRESS','SUBMITTED','REVISION_REQUESTED','COMPLETED','CANCELLED']){const order=await createOrder(app,a,b);await state(order,status);await pool.query("UPDATE workify.orders SET created_at=clock_timestamp()-interval '3 days',deadline_at=clock_timestamp()-interval '1 day' WHERE id=$1",[order.id]);
    const before=(await pool.query('SELECT updated_at FROM workify.orders WHERE id=$1',[order.id])).rows[0].updated_at;
    for(let i=0;i<2;i++){const result=(await app.api(b,`/orders/${order.id}`)).body.order;assert.equal(result.status,status);assert.equal(result.isOverdue,['IN_PROGRESS','SUBMITTED','REVISION_REQUESTED'].includes(status));}
    assert.equal((await pool.query('SELECT updated_at FROM workify.orders WHERE id=$1',[order.id])).rows[0].updated_at.toISOString(),before.toISOString());assert.equal((await pool.query('SELECT count(*) FROM workify.order_events WHERE order_id=$1',[order.id])).rows[0].count,'1');}
});

test('order routes cannot create delete or arbitrarily update status parties price source or deadline',async context=>{
  const app=await setup(context),a=await app.register(),b=await app.register(),order=await createOrder(app,a,b);const before=(await app.api(a,`/orders/${order.id}`)).body.order;
  for(const [path,method,body] of [[`/orders/${order.id}`,'PATCH',{status:'COMPLETED',freelancerId:a.id,deadlineAt:'2030-01-01T00:00:00Z'}],[`/orders/${order.id}`,'DELETE'],['/orders','POST',{projectId:order.project.id,status:'IN_PROGRESS'}]])assert.equal((await app.api(a,path,method,body)).response.status,404);
  assert.equal((await app.api(a,`/orders/${order.id}/cancel`,'POST',{reason:'Подмена статуса',status:'COMPLETED'})).response.status,422);
  assert.equal((await app.api(a,`/orders/${order.id}?mode=freelancer`)).response.status,422);const after=(await app.api(b,`/orders/${order.id}`)).body.order;for(const key of ['status','title','agreedPrice','deadlineAt','updatedAt'])assert.equal(after[key],before[key]);
  assert.equal((await app.api(null,'/missing')).response.status,404);
});

test('history keeps an old cancelled order while a new accepted source assigns the same project to a different freelancer',async context=>{
  const app=await setup(context),a=await app.register(),b=await app.register(),c=await app.register(),old=await createOrder(app,a,b,{file:true});await state(old,'CANCELLED');
  assert.equal((await app.api(a,`/projects/${old.project.id}`,'PATCH',{title:'Второй договор',description:'Новое описание',fileIds:[]})).response.status,200);
  const current=await createOrder(app,a,c,{type:'invitation',project:old.project});const active=(await app.api(a,'/me/orders')).body,history=(await app.api(a,'/me/orders?scope=history')).body;
  assert.deepEqual(active.items.map(row=>row.id),[current.id]);assert.deepEqual(history.items.map(row=>row.id),[old.id]);assert.equal((await app.api(b,`/orders/${current.id}`)).response.status,404);assert.equal((await app.api(c,`/orders/${old.id}`)).response.status,404);
  const saved=(await app.api(b,`/orders/${old.id}`)).body.order;assert.equal(saved.title,old.project.title);assert.equal(saved.files[0].id,old.project.fileId);assert.equal(saved.freelancer.id,b.id);assert.equal((await app.api(c,`/orders/${current.id}`)).body.order.title,'Второй договор');
});
