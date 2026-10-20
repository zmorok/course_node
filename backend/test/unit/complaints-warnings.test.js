import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {complaintInput,complaintQuery} from '../../src/validators/complaints.js';
import {warningInput,warningQuery} from '../../src/validators/warnings.js';
test('complaints require bounded facts and distinct evidence without client-controlled target identity status or decisions',()=>{
  assert.deepEqual({...complaintInput({reason:' Сроки ',description:' Факты '})},{reason:'Сроки',description:'Факты',fileIds:[]});
  const id=randomUUID();for(const patch of [{reason:''},{reason:'x'.repeat(81)},{description:'x'.repeat(5001)},{description:'x\u0000'},{targetId:id},{reporterId:id},{orderId:id},{status:'RESOLVED'},{resolutionNote:'x'},{fileIds:[id,id]},{fileIds:['x']},{fileIds:Array.from({length:9},()=>randomUUID())}])assert.throws(()=>complaintInput({reason:'x',description:'x',...patch}));
});
test('private complaint and warning queries reject received complaints and ownership overrides with bounded pagination',()=>{
  assert.equal(complaintQuery({mode:'freelancer',status:'NEW',page:'2'}).page,2);
  for(const query of [{direction:'received'},{reporterId:randomUUID()},{targetId:randomUUID()},{mode:'admin'},{status:'CLOSED'},{page:'0'},{pageSize:'25'}])assert.throws(()=>complaintQuery(query));
  for(const query of [{userId:randomUUID()},{type:'REJECT'},{page:'10001'},{pageSize:'0'}])assert.throws(()=>warningQuery(query));
});
test('standalone warnings accept only a message and an optional timezone-aware expiry',()=>{
  assert.equal(warningInput({message:' x '}).message,'x');assert.equal(warningInput({message:'x'}).expiresAt,null);
  for(const patch of [{message:''},{message:'x'.repeat(5001)},{message:'x\u0000'},{expiresAt:'2030-10-20'},{expiresAt:'2030-02-30T10:00:00Z'},{complaintId:randomUUID()},{adminId:randomUUID()},{userId:randomUUID()},{actionType:'PERMANENT_BLOCK'}])assert.throws(()=>warningInput({message:'x',...patch}));
});
