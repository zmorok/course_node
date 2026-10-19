import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {freelancerQuery} from '../../src/validators/freelancers.js';
import {invitationCreate,invitationDecline,ownInvitationQuery} from '../../src/validators/invitations.js';
test('directory validates literal search, skills, fractional rating and bounded stable sorting',()=>{
  assert.equal(freelancerQuery({search:' Анна ',minRating:'4.25',skill:'react',page:'2'}).minRating,4.25);
  for(const input of [{minRating:'5.1'},{minRating:'NaN'},{minRating:'-1'},{minRating:'4.999'},{sort:'freelancer_rating;DROP'},{pageSize:'25'},{skill:['react','css']},{role:'ADMIN'},{search:'x\0'}])assert.throws(()=>freelancerQuery(input));
});
test('invitations normalize terms and reject forged identity, state and order fields',()=>{
  const body={freelancerId:randomUUID(),message:' Приглашаю\nв проект ',offeredDeadlineAt:'2030-03-10T18:00:00+03:00'};
  assert.equal(invitationCreate(body).offeredPrice,null);assert.equal(invitationCreate(body).expiresAt,null);
  assert.equal(invitationCreate({...body,offeredPrice:'1500.5',expiresAt:'2030-03-01T12:00:00Z'}).offeredPrice,'1500.50');
  for(const extra of [{customerId:randomUUID()},{projectId:randomUUID()},{status:'ACCEPTED'},{orderId:randomUUID()},{message:''},{message:'x'.repeat(5001)},{offeredPrice:0},{expiresAt:'2030-02-30T00:00:00Z'}])assert.throws(()=>invitationCreate({...body,...extra}));
});
test('invitation decisions allow only a bounded optional decline reason',()=>{
  assert.equal(invitationDecline().reason,'RECIPIENT_DECLINED');assert.equal(invitationDecline({reason:' Нет времени '}).reason,'Нет времени');
  for(const body of [{reason:''},{reason:'x'.repeat(1001)},{reason:'\0'},{status:'EXPIRED'}])assert.throws(()=>invitationDecline(body));
});
test('invitation lists cannot spoof the sender or recipient',()=>{
  assert.equal(ownInvitationQuery({box:'sent',status:'EXPIRED',page:'2'}).page,2);
  for(const query of [{customerId:randomUUID()},{freelancerId:randomUUID()},{box:'all'},{status:'WITHDRAWN'},{page:'0'}])assert.throws(()=>ownInvitationQuery(query));
});
