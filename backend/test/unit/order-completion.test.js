import test from 'node:test';
import assert from 'node:assert/strict';
import {orderCancel} from '../../src/validators/order-work.js';
test('order cancellation requires a bounded reason and rejects forged state parties and timestamps',()=>{
  assert.equal(orderCancel({reason:' Новые приоритеты '}).reason,'Новые приоритеты');
  for(const value of [{},{reason:' '},{reason:'x'.repeat(1001)},{reason:'x\u0000'},{reason:'x',status:'COMPLETED'},{reason:'x',cancelledBy:'user'},{reason:'x',projectStatus:'OPEN'}])assert.throws(()=>orderCancel(value));
});
