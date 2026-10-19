import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { proposalCreate,proposalReject,ownProposalQuery,projectProposalQuery } from '../../src/validators/proposals.js';
test('proposal input normalizes money and time while rejecting forged source/owner/status fields',()=>{
  const input=proposalCreate({message:' Готов выполнить\nзадачу ',offeredPrice:'123.4',offeredDeadlineAt:'2030-01-01T12:00:00+03:00'});
  assert.equal(input.message,'Готов выполнить\nзадачу');assert.equal(input.offeredPrice,'123.40');assert.equal(input.offeredDeadlineAt,'2030-01-01T09:00:00.000Z');
  for(const patch of [{message:''},{message:'x'.repeat(5001)},{message:'text\0hidden'},{offeredPrice:'0'},{offeredPrice:'1.234'},
    {offeredDeadlineAt:'2030-02-30T00:00:00Z'},{offeredDeadlineAt:'2030-01-01'},{status:'ACCEPTED'},{customerId:randomUUID()},{freelancerId:randomUUID()},{orderId:randomUUID()}])assert.throws(()=>proposalCreate({...input,...patch}));
});
test('proposal decisions accept an optional bounded reason without mass assignment',()=>{
  assert.equal(proposalReject({}).reason,'CUSTOMER_REJECTED');assert.equal(proposalReject(undefined).reason,'CUSTOMER_REJECTED');assert.equal(proposalReject({reason:' Другой стек '}).reason,'Другой стек');
  for(const input of [{reason:''},{reason:'x'.repeat(1001)},{status:'REJECTED'},{reason:'\0'}])assert.throws(()=>proposalReject(input));
});
test('private proposal lists validate scope and bounded pagination',()=>{
  const id=randomUUID();assert.equal(ownProposalQuery({projectId:id,status:'PENDING',page:'2',pageSize:'8'}).page,2);
  for(const input of [{freelancerId:id},{customerId:id},{status:'ACTIVE'},{page:'0'},{pageSize:'25'},{status:['PENDING','ACCEPTED']}])assert.throws(()=>ownProposalQuery(input));
  assert.throws(()=>projectProposalQuery({projectId:id}));
});
