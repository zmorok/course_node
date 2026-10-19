import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reviewInput,reviewParams,publicReviewQuery,ownReviewQuery} from '../../src/validators/reviews.js';
test('reviews require integer 1-5 ratings and bounded nonempty text without forged target author order state or media',()=>{
  assert.deepEqual({...reviewInput({rating:4,text:' Хорошая работа '})},{rating:4,text:'Хорошая работа'});
  for(const body of [{rating:0,text:'x'},{rating:6,text:'x'},{rating:4.5,text:'x'},{rating:'5',text:'x'},{rating:5,text:''},{rating:5,text:'x'.repeat(5001)},{rating:5,text:'a\u0000'},{rating:5,text:'x',recipientId:randomUUID()},{rating:5,text:'x',authorId:randomUUID()},{rating:5,text:'x',orderId:randomUUID()},{rating:5,text:'x',deletedAt:null},{rating:5,text:'x',mediaJson:'[]'}])assert.throws(()=>reviewInput(body));
});
test('review lists validate actual mode and direction with bounded pagination and reject identity overrides',()=>{
  assert.equal(publicReviewQuery({}).mode,'freelancer');assert.equal(ownReviewQuery({}).direction,'received');assert.equal(ownReviewQuery({mode:'freelancer',direction:'written',page:'2'}).page,2);
  for(const query of [{mode:'admin'},{direction:'all'},{page:'0'},{pageSize:'25'},{authorId:randomUUID()},{recipientId:randomUUID()},{mode:['customer','freelancer']}])assert.throws(()=>ownReviewQuery(query));assert.throws(()=>publicReviewQuery({direction:'written'}));
});
test('review commands use a validated UUID and no caller-controlled relationship fields',()=>{
  const id=randomUUID();assert.equal(reviewParams({reviewId:id}).reviewId,id);assert.throws(()=>reviewParams({reviewId:'123'}));assert.throws(()=>reviewParams({reviewId:id,orderId:id}));
});
