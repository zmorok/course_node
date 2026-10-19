import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { projectCreate,projectPatch,projectQuery,ownProjectQuery } from '../../src/validators/projects.js';

test('project commands keep decimal precision, normalize dates and support incomplete drafts',()=>{
  const draft=projectCreate({title:' Черновик '});assert.equal(draft.title,'Черновик');assert.equal(draft.categoryId,null);assert.deepEqual(draft.skillIds,[]);
  const result=projectPatch({budget:'9999999999.99',desiredDeadlineAt:'2030-01-01T12:00:00+03:00',description:' Текст\nстрока '});
  assert.equal(result.budget,'9999999999.99');assert.equal(result.desiredDeadlineAt,'2030-01-01T09:00:00.000Z');assert.equal(result.description,'Текст\nстрока');
  assert.equal(projectPatch({budget:'1.2'}).budget,'1.20');assert.equal(projectPatch({budget:null}).budget,null);
});
test('project writes reject identity, status, timestamps, unsafe text and invalid references',()=>{
  const id=randomUUID();
  for(const input of [{},{status:'OPEN'},{customerId:id},{id},{publishedAt:'2030-01-01'},{title:''},{title:'x'.repeat(201)},
    {description:'text\0hidden'},{budget:'0'},{budget:'1.001'},{budget:'10000000000'},{budget:'1e3'},
    {desiredDeadlineAt:'2030-01-01'},{desiredDeadlineAt:'2030-02-30T00:00:00Z'},{desiredDeadlineAt:'2030-01-01T24:00:00Z'},
    {categoryId:'backend'},{skillIds:[id,id]},{fileIds:Array.from({length:9},()=>randomUUID())}]) assert.throws(()=>projectPatch(input),JSON.stringify(input));
});
test('catalog query validates bounded pagination, sort/filter whitelist and budget ranges',()=>{
  const query=projectQuery({search:'  API%_ ',category:'backend',skill:'nodejs',minBudget:'0',maxBudget:'100.25',sort:'budget_asc',page:'2',pageSize:'8'});
  assert.equal(query.page,2);assert.equal(query.search,'API%_');assert.equal(query.minBudget,'0.00');assert.equal(ownProjectQuery({status:'COMPLETED'}).status,'COMPLETED');
  for(const input of [{status:'DRAFT'},{customerId:randomUUID()},{page:'0'},{page:'10001'},{pageSize:'25'},{page:'1.5'},{sort:'id;DROP TABLE users'},
    {search:['a','b']},{minBudget:'200',maxBudget:'100'},{maxBudget:'NaN'},{category:'../secret'}]) assert.throws(()=>projectQuery(input));
});
