import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {loadConfig} from '../../src/config/env.js';
import {createDatabasePool} from '../../src/config/database.js';
import {marketplace,future} from '../helpers/marketplace.js';
if(process.env.WORKIFY_DB_TESTS!=='1')throw new Error('Use the disposable infrastructure database');
const config=loadConfig({...process.env,NODE_ENV:'test'}),pool=createDatabasePool(config.database);after(()=>pool.end());
const setup=(context,options)=>marketplace(context,pool,config,options);
async function orderCount(project){return Number((await pool.query('SELECT count(*) FROM workify.orders WHERE project_id=$1',[project.id])).rows[0].count);}

test('directory searches public active clients by name and username with literal text, skills and stable pagination, without private data',async context=>{
  const app=await setup(context),key=randomUUID().slice(0,8),a=await app.register({firstName:key,lastName:'Альфа'}),b=await app.register({firstName:key,lastName:'Бета'}),c=await app.register({firstName:key,lastName:'Гамма'});
  const skill=(await app.api(null,'/skills')).body.skills.find(row=>row.slug==='react');assert.equal((await app.api(a,'/me/skills','PUT',{skillIds:[skill.id]})).response.status,200);
  const list=(await app.api(null,`/freelancers?search=${key}&sort=name&pageSize=1`)).body;assert.equal(list.total,3);assert.equal(list.items[0].id,a.id);
  assert.equal((await app.api(null,`/freelancers?search=${key}&sort=name&pageSize=1&page=2`)).body.items[0].id,b.id);
  const beyond=(await app.api(null,`/freelancers?search=${key}&page=9&pageSize=1`)).body;assert.equal(beyond.total,3);assert.deepEqual(beyond.items,[]);
  assert.equal((await app.api(null,`/freelancers?search=${key}&skill=react`)).body.items[0].id,a.id);
  assert.equal((await app.api(null,`/freelancers?search=${a.user.username.toUpperCase()}`)).body.total,1);
  assert.equal((await app.api(null,`/freelancers?search=${encodeURIComponent(`${key} Альфа`)}`)).body.items[0].id,a.id);
  assert.equal((await app.api(null,'/freelancers?search=%25')).body.total,0);
  for(const row of list.items)for(const field of ['email','phone','password_hash','role','status','blocked_until'])assert(!Object.hasOwn(row,field));
  await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[b.id]);await pool.query("UPDATE workify.users SET status='BLOCKED',blocked_by=id,blocked_at=now(),block_reason='test' WHERE id=$1",[c.id]);
  assert.equal((await app.api(null,`/freelancers?search=${key}`)).body.total,1);
  await pool.query("UPDATE workify.users SET blocked_at=now()-interval '2 days',blocked_until=now()-interval '1 day' WHERE id=$1",[c.id]);assert.equal((await app.api(null,`/freelancers?search=${key}`)).body.total,2);
  for(const query of ['minRating=6','page=0','sort=sql','skill=react&skill=css','customerId='+a.id])assert.equal((await app.api(null,`/freelancers?${query}`)).response.status,422);
});

test('directory filters and sorts actual freelancer ratings; unrated clients do not satisfy a minimum',async context=>{
  const app=await setup(context),key=randomUUID().slice(0,8),owner=await app.register(),a=await app.register({firstName:key}),b=await app.register({firstName:key});
  for(const rating of [4,5]){const project=await app.project(owner),source=await app.proposal(a,project);const accepted=await app.api(owner,`/proposals/${source.id}/accept`,'POST',{});assert.equal(accepted.response.status,200);const order=accepted.body.proposal.order;
    await pool.query("UPDATE workify.orders SET status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",[order.id]);await pool.query("UPDATE workify.projects SET status='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",[project.id]);
    await pool.query('INSERT INTO workify.reviews(order_id,customer_id,freelancer_id,author_id,recipient_id,rating,text) VALUES($1,$2,$3,$2,$3,$4,\'Проверка рейтинга\')',[order.id,owner.id,a.id,rating]);}
  const list=(await app.api(null,`/freelancers?search=${key}&minRating=4.25&sort=rating`)).body;assert.equal(list.total,1);assert.equal(list.items[0].id,a.id);assert.equal(Number(list.items[0].freelancerRating),4.5);assert.equal(list.items[0].freelancerReviewCount,2);
  assert.equal((await app.api(null,`/freelancers?search=${key}&minRating=4.75`)).body.total,0);assert.equal((await app.api(null,`/freelancers?search=${key}&sort=rating`)).body.items[1].id,b.id);
});

test('invitation creation enforces ownership CLIENT role active recipient OPEN project terms and no forged fields',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),other=await app.register(),project=await app.project(owner);
  assert.equal((await app.invite(null,project,author)).response.status,401);assert.equal((await app.invite(other,project,author)).response.status,404);assert.equal((await app.invite(owner,project,owner)).response.status,403);
  for(const patch of [{customerId:owner.id},{status:'ACCEPTED'},{orderId:randomUUID()},{offeredDeadlineAt:new Date(Date.now()-1000).toISOString()},{expiresAt:new Date(Date.now()-1000).toISOString()}])assert.equal((await app.invite(owner,project,author,patch)).response.status,422);
  const draft=await app.project(owner,{draft:true});assert.equal((await app.invite(owner,draft,author)).response.status,409);
  await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[other.id]);assert.equal((await app.invite(other,project,author)).response.status,403);assert.equal((await app.invite(owner,project,other)).response.status,404);
  const source=await app.invitation(owner,project,author,{offeredPrice:null,expiresAt:null});assert.equal(source.status,'PENDING');assert.equal(source.order,null);assert.equal(source.offeredPrice,null);assert.equal(source.customer.id,owner.id);assert.equal(source.freelancer.id,author.id);assert.equal(await orderCount(project),0);
  assert.equal((await pool.query("SELECT count(*) FROM workify.notifications WHERE invitation_id=$1 AND event_type='INVITATION_CREATED'",[source.id])).rows[0].count,'1');
});

test('project picker returns only own available OPEN projects; concurrent duplicate invitations have one winner',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),other=await app.register(),project=await app.project(owner);await app.project(owner,{draft:true});await app.project(other);
  const path=`/freelancers/${author.id}/projects`;assert.equal((await app.api(null,path)).response.status,401);assert.equal((await app.api(owner,`/freelancers/${owner.id}/projects`)).response.status,403);
  assert.deepEqual((await app.api(owner,path)).body.projects.map(p=>p.id),[project.id]);
  const results=await Promise.all([app.invite(owner,project,author),app.invite(owner,project,author)]);assert.deepEqual(results.map(r=>r.response.status).sort(),[201,409]);const source=results.find(r=>r.response.status===201).body.invitation;
  assert.deepEqual((await app.api(owner,path)).body.projects,[]);assert.equal((await app.act(author,source,'decline')).response.status,200);assert.equal((await app.api(owner,path)).body.projects.length,1);
});

test('private incoming sent project lists and decisions enforce recipient and preserve decline history',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),other=await app.register(),project=await app.project(owner),source=await app.invitation(owner,project,author);
  for(const actor of [owner,other])for(const command of ['accept','decline'])assert.equal((await app.act(actor,source,command)).response.status,404);
  assert.equal((await app.api(other,`/invitations/${source.id}`)).response.status,404);assert.equal((await app.api(author,`/projects/${project.id}/invitations`)).response.status,404);
  assert.equal((await app.api(author,'/me/invitations')).body.items[0].id,source.id);assert.equal((await app.api(owner,'/me/invitations?box=sent')).body.items[0].id,source.id);assert.equal((await app.api(owner,'/me/invitations')).body.total,0);
  const declined=await app.act(author,source,'decline',{reason:'Нет свободного времени'});assert.equal(declined.body.invitation.status,'DECLINED');assert.equal(declined.body.invitation.closureReason,'Нет свободного времени');assert.equal(declined.body.invitation.offeredPrice,source.offeredPrice);assert.equal(await orderCount(project),0);
  assert.equal((await app.act(author,source,'accept')).response.status,409);assert.equal((await app.api(owner,'/me/invitations?box=sent&status=DECLINED&page=2&pageSize=1')).body.total,1);
  for(const query of ['box=all','status=REJECTED','freelancerId='+author.id])assert.equal((await app.api(owner,`/me/invitations?${query}`)).response.status,422);
  const dto=(await app.api(owner,`/invitations/${source.id}`)).body.invitation;for(const key of ['email','phone','password_hash','role','blocked_until'])assert(!JSON.stringify(dto).includes(`"${key}"`));
});

test('invitation acceptance uses the same agreement and files as proposals and closes incompatible sources',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),other=await app.register(),project=await app.project(owner,{file:true});
  const source=await app.invitation(owner,project,author),competitor=await app.invitation(owner,project,other),proposal=await app.proposal(author,project);
  const result=await app.act(author,source,'accept');assert.equal(result.response.status,200,JSON.stringify(result.body));const accepted=result.body.invitation,order=accepted.order;
  assert.equal(accepted.status,'ACCEPTED');assert.equal(order.status,'IN_PROGRESS');assert.equal(order.agreedPrice,'2400.50');assert.equal(order.initialDeadlineAt,source.offeredDeadlineAt);assert.equal(order.deadlineAt,source.offeredDeadlineAt);assert.equal(order.title,project.title);assert.equal(order.description,project.description);assert.equal(order.files[0].id,project.fileId);
  const stored=(await pool.query('SELECT * FROM workify.orders WHERE id=$1',[order.id])).rows[0];assert.equal(stored.proposal_id,null);assert.equal(stored.invitation_id,source.id);assert.equal(stored.customer_id,owner.id);assert.equal(stored.freelancer_id,author.id);
  assert.equal((await app.api(owner,`/projects/${project.id}`)).body.project.status,'IN_PROGRESS');assert.equal((await app.api(null,`/projects/${project.id}`)).response.status,404);
  assert.equal((await app.api(other,`/invitations/${competitor.id}`)).body.invitation.closureReason,'OTHER_SOURCE_ACCEPTED');assert.equal((await app.api(author,`/proposals/${proposal.id}`)).body.proposal.status,'REJECTED');
  assert.equal((await pool.query("SELECT count(*) FROM workify.order_events WHERE order_id=$1 AND event_type='ORDER_CREATED'",[order.id])).rows[0].count,'1');assert.equal((await pool.query("SELECT count(*) FROM workify.notifications WHERE order_id=$1 AND event_type='ORDER_CREATED'",[order.id])).rows[0].count,'2');
  assert.equal((await app.api(author,`/files/${project.fileId}`)).body.toString(),'Задание по приглашению');for(const actor of [null,other])assert.equal((await app.api(actor,`/files/${project.fileId}`)).response.status,404);
  assert.equal((await app.invite(owner,project,other)).response.status,409);assert.deepEqual((await app.api(owner,`/freelancers/${other.id}/projects`)).body.projects,[]);
});

test('concurrent invitation acceptance and mixed proposal acceptance create exactly one order and event without repeat effects',async context=>{
  const app=await setup(context),owner=await app.register(),a=await app.register(),b=await app.register();
  for(const mode of ['same','different','proposal']){const project=await app.project(owner),first=await app.invitation(owner,project,a),second=mode==='same'?first:mode==='proposal'?await app.proposal(b,project):await app.invitation(owner,project,b);
    const results=await Promise.all([app.act(a,first,'accept'),mode==='proposal'?app.api(owner,`/proposals/${second.id}/accept`,'POST',{}):app.act(mode==='same'?a:b,second,'accept')]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);assert.equal(await orderCount(project),1);
    assert.equal((await pool.query('SELECT count(*) FROM workify.order_events e JOIN workify.orders o ON o.id=e.order_id WHERE o.project_id=$1',[project.id])).rows[0].count,'1');
    const before=(await pool.query('SELECT count(*) FROM workify.notifications WHERE project_id=$1',[project.id])).rows[0].count;assert.equal((await app.act(a,first,'accept')).response.status,409);assert.equal((await pool.query('SELECT count(*) FROM workify.notifications WHERE project_id=$1',[project.id])).rows[0].count,before);}
});

test('late event failure rolls back invitation project order file snapshot alternatives audit and notifications',async context=>{
  let failing=true;const app=await setup(context,{failEvent:()=>failing}),owner=await app.register(),a=await app.register(),b=await app.register(),project=await app.project(owner,{file:true}),first=await app.invitation(owner,project,a),second=await app.invitation(owner,project,b),proposal=await app.proposal(a,project);
  const before=(await pool.query('SELECT count(*) FROM workify.notifications WHERE project_id=$1',[project.id])).rows[0].count;assert.equal((await app.act(a,first,'accept')).response.status,500);assert.equal(await orderCount(project),0);
  assert.equal((await app.api(owner,`/projects/${project.id}`)).body.project.status,'OPEN');assert.equal((await app.api(a,`/invitations/${first.id}`)).body.invitation.status,'PENDING');assert.equal((await app.api(b,`/invitations/${second.id}`)).body.invitation.status,'PENDING');assert.equal((await app.api(a,`/proposals/${proposal.id}`)).body.proposal.status,'PENDING');
  assert.equal((await pool.query("SELECT count(*) FROM workify.audit_logs WHERE action='ORDER_CREATED' AND metadata->>'projectId'=$1",[project.id])).rows[0].count,'0');assert.equal((await pool.query('SELECT count(*) FROM workify.notifications WHERE project_id=$1',[project.id])).rows[0].count,before);
  failing=false;assert.equal((await app.act(a,first,'accept')).response.status,200);
});

test('both response expiry and offered-deadline expiry persist before errors and allow fresh invitations without duplicate effects',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register();
  for(const kind of ['response','terms']){const project=await app.project(owner),source=await app.invitation(owner,project,author);
    await pool.query(`UPDATE workify.project_invitations SET created_at=clock_timestamp()-interval '2 days',${kind==='response'?'expires_at':'offered_deadline_at'}=clock_timestamp()-interval '1 day' WHERE id=$1`,[source.id]);
    const read=(await app.api(author,`/invitations/${source.id}`)).body.invitation;assert.equal(read.expired,true);assert.equal(read.canRespond,false);
    const result=await app.act(author,source,'accept');assert.equal(result.response.status,409);assert.equal(result.body.error.code,'INVITATION_EXPIRED');assert.equal(await orderCount(project),0);
    const stored=(await app.api(owner,`/invitations/${source.id}`)).body.invitation;assert.equal(stored.status,'EXPIRED');assert.equal(stored.closureReason,kind==='response'?'TIME_EXPIRED':'TERMS_EXPIRED');
    const before=(await pool.query('SELECT count(*) FROM workify.notifications WHERE invitation_id=$1',[source.id])).rows[0].count;assert.equal((await app.act(author,source,'accept')).response.status,409);assert.equal((await pool.query('SELECT count(*) FROM workify.notifications WHERE invitation_id=$1',[source.id])).rows[0].count,before);
    assert.equal((await app.invite(owner,project,author)).response.status,201);}
});

test('current role and blocking protect both parties while counterpart errors preserve recipient identity',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),project=await app.project(owner),source=await app.invitation(owner,project,author);
  await pool.query("UPDATE workify.users SET status='BLOCKED',blocked_by=id,blocked_at=now(),block_reason='test' WHERE id=$1",[owner.id]);const blocked=await app.act(author,source,'accept');assert.equal(blocked.response.status,409);assert.equal(blocked.body.error.code,'COUNTERPARTY_UNAVAILABLE');assert.equal((await app.api(author,'/auth/me')).response.status,200);
  await pool.query("UPDATE workify.users SET blocked_at=now()-interval '2 days',blocked_until=now()-interval '1 day' WHERE id=$1",[owner.id]);assert.equal((await app.act(author,source,'accept')).response.status,200);
  await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[author.id]);assert.equal((await app.api(author,'/me/invitations')).response.status,403);
});

test('acceptance racing project changes cancellation or decline has one coherent result',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register();
  for(const kind of ['edit','cancel','decline']){const project=await app.project(owner),source=await app.invitation(owner,project,author);
    const other=kind==='edit'?app.api(owner,`/projects/${project.id}`,'PATCH',{description:'Новое задание'}):kind==='cancel'?app.api(owner,`/projects/${project.id}/cancel`,'POST',{reason:'Планы изменились'}):app.act(author,source,'decline');
    const results=await Promise.all([app.act(author,source,'accept'),other]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);const current=(await app.api(author,`/invitations/${source.id}`)).body.invitation;assert.equal(await orderCount(project),current.status==='ACCEPTED'?1:0);}
});

test('null price is preserved and agreed invitation files survive a later project change for both parties',async context=>{
  const app=await setup(context),owner=await app.register(),author=await app.register(),other=await app.register(),project=await app.project(owner,{file:true}),source=await app.invitation(owner,project,author,{offeredPrice:null});
  const result=await app.act(author,source,'accept');assert.equal(result.response.status,200);const order=result.body.invitation.order;assert.equal(order.agreedPrice,null);
  await pool.query("UPDATE workify.orders SET status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=$2,cancellation_reason='Test fixture' WHERE id=$1",[order.id,owner.id]);await pool.query("UPDATE workify.projects SET status='OPEN' WHERE id=$1",[project.id]);
  assert.equal((await app.api(owner,`/projects/${project.id}`,'PATCH',{title:'Новое задание',description:'Изменено',fileIds:[]})).response.status,200);
  const history=(await app.api(author,`/invitations/${source.id}`)).body.invitation;assert.equal(history.order.title,project.title);assert.equal(history.order.description,project.description);assert.equal(history.order.files[0].id,project.fileId);
  for(const actor of [owner,author])assert.equal((await app.api(actor,`/files/${project.fileId}`)).response.status,200);for(const actor of [other,null])assert.equal((await app.api(actor,`/files/${project.fileId}`)).response.status,404);assert.equal((await app.api(owner,`/files/${project.fileId}`,'DELETE')).response.status,409);
});
