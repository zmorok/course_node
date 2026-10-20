import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../../src/config/env.js';
import {createDatabasePool} from '../../src/config/database.js';
import {marketplace} from '../helpers/marketplace.js';
if(process.env.WORKIFY_DB_TESTS!=='1')throw new Error('Use the disposable infrastructure database');
const config=loadConfig({...process.env,NODE_ENV:'test'}),pool=createDatabasePool(config.database);after(()=>pool.end());
const status=(response,expected)=>{assert.equal(response.response.status,expected,JSON.stringify(response.body));return response.body;};
test('course E2E: register publish propose accept submit revise resubmit complete reciprocal reviews complaint admin warning and recipient read',async context=>{
 const app=await marketplace(context,pool,config),a=await app.register(),b=await app.register(),outsider=await app.register(),admin=await app.register();
 await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[admin.id]);
 const project=await app.project(a,{file:true}),proposal=await app.proposal(b,project);
 const order=status(await app.api(a,`/proposals/${proposal.id}/accept`,'POST',{}),200).proposal.order;
 status(await app.api(outsider,`/orders/${order.id}`),404);status(await app.api(a,`/orders/${order.id}/submissions`,'POST',{comment:'Чужая роль',links:['https://example.org/wrong']}),409);
 let submission=status(await app.api(b,`/orders/${order.id}/submissions`,'POST',{comment:'Первая версия',links:['https://example.org/version-1']}),201);
 status(await app.api(a,`/orders/${order.id}/submissions/${submission.submissionId}/revision`,'POST',{comment:'Добавить мобильную навигацию'}),200);
 assert.equal(status(await app.api(a,`/orders/${order.id}`),200).order.status,'REVISION_REQUESTED');
 submission=status(await app.api(b,`/orders/${order.id}/submissions`,'POST',{comment:'Исправленная версия',links:['https://example.org/version-2']}),201);
 status(await app.api(a,`/orders/${order.id}/submissions/${submission.submissionId}/accept`,'POST',{}),200);
 assert.equal(status(await app.api(a,`/orders/${order.id}`),200).order.status,'COMPLETED');
 for(const [actor,rating,target] of [[a,5,b],[b,4,a]]){const review=status(await app.api(actor,`/orders/${order.id}/reviews`,'POST',{rating,text:'Согласовали и завершили работу'}),201).review;assert.equal(review.recipient.id,target.id);}
 assert.equal(status(await app.api(null,`/users/${b.id}`),200).profile.freelancerRating,'5.00');
 const complaint=status(await app.api(a,`/orders/${order.id}/complaints`,'POST',{reason:'Спор о процессе',description:'Проверить первую версию и историю доработки'}),201).complaint;
 status(await app.api(b,`/me/complaints/${complaint.id}`),404);status(await app.api(a,`/admin/complaints/${complaint.id}`),403);
 status(await app.api(admin,`/admin/complaints/${complaint.id}/claim`,'POST',{}),200);
 status(await app.api(admin,`/admin/complaints/${complaint.id}/resolve`,'POST',{resolutionNote:'Работа принята, нарушение процесса подтверждено',actions:[{targetId:b.id,type:'WARNING',reason:'Уточняйте требования перед сдачей'}]}),200);
 const warnings=status(await app.api(b,'/me/warnings'),200);assert.equal(warnings.total,1);assert.equal(warnings.items[0].complaintId,complaint.id);assert.equal(warnings.items[0].message,'Уточняйте требования перед сдачей');assert.equal(status(await app.api(a,'/me/warnings'),200).total,0);
 const notice=status(await app.api(a,'/me/notifications?read=unread&pageSize=24'),200).items.find(row=>row.type==='COMPLAINT_RESOLVED');assert.equal(notice.href,`/me/complaints/${complaint.id}`);status(await app.api(a,`/me/notifications/${notice.id}/read`,'POST',{}),200);
 const versions=status(await app.api(a,`/orders/${order.id}/submissions`),200);assert.equal(versions.total,2);assert.equal(versions.items[0].status,'ACCEPTED');assert.equal(versions.items[1].status,'REVISION_REQUESTED');assert.equal(status(await app.api(a,`/orders/${order.id}/reviews`),200).items.length,2);
});
test('course E2E: invitation cancellation reopens the project and a replacement order preserves the original agreement and access',async context=>{
 const app=await marketplace(context,pool,config),a=await app.register(),b=await app.register(),c=await app.register(),project=await app.project(a,{file:true});
 const invitation=await app.invitation(a,project,b);status(await app.act(a,invitation,'accept'),404);const original=status(await app.act(b,invitation,'accept'),200).invitation.order;
 status(await app.api(a,`/orders/${original.id}/cancel`,'POST',{reason:'Изменился состав команды'}),200);assert.equal(status(await app.api(a,`/projects/${project.id}`),200).project.status,'OPEN');
 status(await app.api(a,`/projects/${project.id}`,'PATCH',{title:'Новая согласованная работа'}),200);const proposal=await app.proposal(c,project),replacement=status(await app.api(a,`/proposals/${proposal.id}/accept`,'POST',{}),200).proposal.order;
 assert.notEqual(replacement.id,original.id);const history=status(await app.api(b,`/orders/${original.id}`),200).order;assert.equal(history.status,'CANCELLED');assert.equal(history.title,project.title);assert.equal(history.freelancer.id,b.id);assert.equal(history.source.type,'invitation');assert.equal(history.files[0].id,project.fileId);assert.equal(status(await app.api(c,`/orders/${replacement.id}`),200).order.title,'Новая согласованная работа');
 status(await app.api(b,`/orders/${replacement.id}`),404);status(await app.api(c,`/orders/${original.id}`),404);assert.equal(status(await app.api(a,'/me/orders?scope=history'),200).items[0].id,original.id);assert.equal(status(await app.api(a,'/me/orders?scope=active'),200).items[0].id,replacement.id);
});
