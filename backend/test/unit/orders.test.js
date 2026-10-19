import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {orderQuery,orderParams,orderDetailQuery} from '../../src/validators/orders.js';
import {orderMode,orderPermissions,requireOrderAction} from '../../src/services/order-policy.js';
const customer={id:randomUUID(),role:'CLIENT',status:'ACTIVE'},freelancer={id:randomUUID(),role:'CLIENT',status:'ACTIVE'};
const row=patch=>({customer_id:customer.id,freelancer_id:freelancer.id,status:'IN_PROGRESS',last_submission_id:null,last_submission_status:null,pending_deadline_id:null,deadline_request_current:false,...patch});
test('order queries whitelist modes scopes statuses bounded pagination and UUIDs without ownership overrides',()=>{
  assert.equal(orderQuery({}).mode,'customer');assert.equal(orderQuery({mode:'freelancer',scope:'history',status:'CANCELLED',page:'2'}).page,2);
  for(const input of [{customerId:customer.id},{freelancerId:freelancer.id},{mode:'ADMIN'},{scope:'all'},{status:'COMPLETED'},{scope:'history',status:'SUBMITTED'},{pageSize:'25'},{page:'0'},{mode:['customer','freelancer']}])assert.throws(()=>orderQuery(input));
  assert.throws(()=>orderParams({orderId:'123'}));assert.equal(orderParams({orderId:customer.id}).orderId,customer.id);assert.throws(()=>orderDetailQuery({mode:'customer'}));
});
test('server matrix derives the actual participant for every status and never changes system roles',()=>{
  for(const status of ['IN_PROGRESS','SUBMITTED','REVISION_REQUESTED','COMPLETED','CANCELLED']){
    const order=row({status,last_submission_id:randomUUID(),last_submission_status:'SUBMITTED'}),c=orderPermissions(customer,order),f=orderPermissions(freelancer,order);
    assert.equal(orderMode(customer,order),'customer');assert.equal(orderMode(freelancer,order),'freelancer');assert(c.read&&f.read);
    assert.equal(c.submit,false);assert.equal(c.requestDeadline,false);assert.equal(f.acceptSubmission,false);assert.equal(f.requestRevision,false);assert.equal(f.approveDeadline,false);
    assert.equal(f.submit,['IN_PROGRESS','REVISION_REQUESTED'].includes(status));assert.equal(f.requestDeadline,f.submit);assert.equal(c.acceptSubmission,status==='SUBMITTED');assert.equal(c.requestRevision,c.acceptSubmission);
    assert.equal(c.cancel,['IN_PROGRESS','SUBMITTED','REVISION_REQUESTED'].includes(status));assert.equal(f.cancel,c.cancel);
  }
});
test('submission review targets the last pending version and deadline decisions require current pending terms',()=>{
  assert.equal(orderPermissions(customer,row({status:'SUBMITTED'})).acceptSubmission,false);
  assert.equal(orderPermissions(customer,row({status:'SUBMITTED',last_submission_id:randomUUID(),last_submission_status:'REVISION_REQUESTED'})).acceptSubmission,false);
  const current=row({pending_deadline_id:randomUUID(),deadline_request_current:true});assert.equal(orderPermissions(customer,current).approveDeadline,true);assert.equal(orderPermissions(customer,current).rejectDeadline,true);assert.equal(orderPermissions(freelancer,current).requestDeadline,false);
  assert.equal(orderPermissions(customer,{...current,status:'SUBMITTED'}).approveDeadline,false);assert.equal(orderPermissions(customer,{...current,deadline_request_current:false}).approveDeadline,false);assert.equal(orderPermissions(freelancer,{...current,deadline_request_current:false}).requestDeadline,true);
  assert.deepEqual(orderPermissions(freelancer,row({is_overdue:true})),orderPermissions(freelancer,row({is_overdue:false})));
});
test('nonparticipants admins inactive accounts and missing orders have no domain rights',()=>{
  for(const actor of [null,{id:randomUUID(),role:'CLIENT',status:'ACTIVE'},{...customer,role:'ADMIN'},{...customer,status:'BLOCKED'}])assert(Object.values(orderPermissions(actor,row())).every(value=>value===false));
  assert.equal(orderMode(null,null),null);assert(Object.values(orderPermissions(customer,null)).every(value=>value===false));
  assert.equal(orderPermissions({...customer,status:'BLOCKED',blocked_until:new Date(Date.now()-10000)},row()).read,true);
});
test('action guard enforces identity and rejects unknown actions and terminal writes',()=>{
  assert.equal(requireOrderAction(customer,row(),'read').read,true);
  assert.throws(()=>requireOrderAction({id:randomUUID(),role:'CLIENT',status:'ACTIVE'},row(),'read'),error=>error.statusCode===404);
  assert.throws(()=>requireOrderAction({...customer,role:'ADMIN'},row(),'read'),error=>error.statusCode===403);
  for(const action of ['submit','setStatus','__proto__'])assert.throws(()=>requireOrderAction(customer,row(),action),error=>error.code==='ORDER_ACTION_NOT_ALLOWED');
  assert.throws(()=>requireOrderAction(freelancer,row({status:'COMPLETED'}),'cancel'),error=>error.statusCode===409);
});
