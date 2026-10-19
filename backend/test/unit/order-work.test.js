import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {submissionCreate,submissionRevision,submissionAccept,deadlineCreate,deadlineReject,deadlineApprove,submissionParams,deadlineParams,workQuery} from '../../src/validators/order-work.js';
test('submission requires a bounded comment and actual safe result links or distinct files, never forged state or ownership',()=>{
  const id=randomUUID();assert.deepEqual({...submissionCreate({comment:' Готово ',fileIds:[id]})},{comment:'Готово',fileIds:[id],links:[]});assert.equal(submissionCreate({comment:'Готово',links:['https://example.org/result']}).links.length,1);
  for(const input of [{comment:'Готово'},{comment:' ',links:['https://example.org']},{comment:'x',fileIds:[id,id]},{comment:'x',fileIds:Array(9).fill(id)},{comment:'x',links:['javascript:alert(1)']},{comment:'x',links:['https://a:b@example.org']},{comment:'x',links:['https://example.org/a b']},{comment:'x',links:['https://example.org'],version:10},{comment:'x',links:['https://example.org'],status:'ACCEPTED'},{comment:'x\u0000',fileIds:[id]}])assert.throws(()=>submissionCreate(input));
});
test('review validates explicit comments and cannot rewrite result contents or reviewer identity',()=>{
  assert.deepEqual({...submissionAccept()},{comment:null});assert.deepEqual({...submissionRevision({comment:' Исправить фильтр '})},{comment:'Исправить фильтр'});
  for(const input of [{},{comment:''},{comment:'x',reviewedBy:randomUUID()},{comment:'x',links:[]},{comment:'x',status:'ACCEPTED'}])assert.throws(()=>submissionRevision(input));assert.throws(()=>submissionAccept({comment:'x',version:2}));
});
test('deadline commands keep timezone, normalize ISO and require reasons for request and rejection',()=>{
  assert.equal(deadlineCreate({proposedDeadlineAt:'2027-01-01T12:00:00+03:00',reason:' Изменился объём '}).proposedDeadlineAt,'2027-01-01T09:00:00.000Z');assert.deepEqual({...deadlineApprove()},{reason:null});assert.deepEqual({...deadlineReject({reason:'Не подходит'})},{reason:'Не подходит'});
  for(const input of [{proposedDeadlineAt:'2027-02-30T10:00:00Z',reason:'x'},{proposedDeadlineAt:'2027-01-01T12:00',reason:'x'},{proposedDeadlineAt:'2027-01-01T12:00:00Z',reason:' '},{proposedDeadlineAt:'2027-01-01T12:00:00Z',reason:'x',status:'APPROVED'}])assert.throws(()=>deadlineCreate(input));assert.throws(()=>deadlineReject({}));assert.throws(()=>deadlineApprove({decidedBy:randomUUID()}));
});
test('private work histories have bounded pagination and decisions require both UUIDs',()=>{
  assert.deepEqual({...workQuery({})},{page:1,pageSize:12});assert.equal(workQuery({page:'2',pageSize:'1'}).page,2);for(const input of [{page:'0'},{pageSize:'25'},{freelancerId:randomUUID()},{status:'SUBMITTED'}])assert.throws(()=>workQuery(input));
  const orderId=randomUUID();assert.throws(()=>submissionParams({orderId,submissionId:'old'}));assert.throws(()=>deadlineParams({orderId,requestId:'old'}));assert.equal(submissionParams({orderId,submissionId:orderId}).submissionId,orderId);
});
