import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationQuery,notificationParams,notificationEmpty} from '../../src/validators/notifications.js';
import {createNotificationService} from '../../src/services/notification.service.js';
test('notification input rejects recipient injection invalid states unbounded pages arrays and forged read fields',()=>{
  assert.equal(notificationQuery({}).read,'all');assert.equal(notificationQuery({page:'2',pageSize:'24',read:'unread'}).page,2);
  for(const input of [{recipientId:'other'},{read:['read','unread']},{read:'anything'},{page:'0'},{pageSize:'25'},{page:'1 OR 1=1'}])assert.throws(()=>notificationQuery(input));
  assert.throws(()=>notificationParams({notificationId:'not-a-uuid'}));assert.throws(()=>notificationEmpty({readAt:'2026-01-01'}));
});
test('notification projection excludes internal metadata and only uses the authenticated recipient for reads and updates',async()=>{
 const recipient='authenticated',id='notice',calls=[],row={id,event_type:'ORDER_CREATED',order_id:'order',message:'Событие',created_at:'2026-10-20T00:00:00.123456+00:00',read_at:null,metadata:{href:'https://attacker.invalid',token:'private'}};
 const service=createNotificationService({repository:{list:async(...args)=>{calls.push(args);return {items:[row],total:1,unread_count:1};},markRead:async(...args)=>{calls.push(args);return undefined;}}});
 const data=await service.list({id:recipient,status:'ACTIVE'},{page:1,pageSize:12});assert.equal(calls[0][0],recipient);assert.equal(data.items[0].href,'/orders/order');assert.equal(data.items[0].createdAt,'2026-10-20T00:00:00.123Z');assert(!JSON.stringify(data).includes('attacker'));assert(!JSON.stringify(data).includes('token'));await assert.rejects(service.markRead({id:recipient,status:'ACTIVE'},id),error=>error.statusCode===404);assert.deepEqual(calls[1],[recipient,id]);await assert.rejects(service.list(null,{}),error=>error.statusCode===401);
});
