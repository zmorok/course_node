import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectFile,MAX_FILE_BYTES } from '../../src/services/file-policy.js';
import { createLocalStorage } from '../../src/storage/local-storage.js';
import { createFileService } from '../../src/services/file.service.js';
import { portfolioInput } from '../../src/validators/portfolio.js';

test('file inspection rejects MIME spoofing, executable names, traversal, empty and oversized files',async () => {
  for (const input of [
    { originalname:'x.png',mimetype:'image/png',buffer:Buffer.from('<html>fake</html>') },
    { originalname:'../x.txt',mimetype:'text/plain',buffer:Buffer.from('text') },
    { originalname:'C:\\x.txt',mimetype:'text/plain',buffer:Buffer.from('text') },
    { originalname:'x.svg',mimetype:'image/svg+xml',buffer:Buffer.from('<svg/>') },
    { originalname:'x.txt',mimetype:'text/plain',buffer:Buffer.from([0xff,0,0]) },
    { originalname:'x.txt',mimetype:'text/plain',buffer:Buffer.alloc(0) },
    { originalname:'x.txt',mimetype:'text/plain',buffer:Buffer.alloc(MAX_FILE_BYTES+1) },
  ]) await assert.rejects(inspectFile(input));
  const result = await inspectFile({ originalname:'Описание.txt',mimetype:'text/plain',buffer:Buffer.from('Описание\nпроекта') });
  assert.equal(result.mimeType,'text/plain'); assert.match(result.sha256,/^[a-f0-9]{64}$/);
});

test('local storage refuses path escape and symlinks, never overwrites and removes idempotently',async context => {
  const root = await mkdtemp(join(tmpdir(),'workify-storage-'));
  context.after(() => rm(root,{ recursive:true,force:true }));
  const storage = createLocalStorage(root);
  await storage.save('file.txt',Buffer.from('original'));
  await assert.rejects(storage.save('file.txt',Buffer.from('changed')),{ code:'EEXIST' });
  for (const key of ['../outside','/etc/passwd','C:\\file','x/y','x\\y','..','x..y']) await assert.rejects(storage.open(key));
  await symlink(join(root,'file.txt'),join(root,'link.txt'));
  await assert.rejects(storage.open('link.txt'));
  assert.equal(await readFile(join(root,'file.txt'),'utf8'),'original');
  await storage.remove('file.txt'); await storage.remove('file.txt');
});

test('failed metadata transaction removes the already saved object',async () => {
  const actor = { id:'actor',role:'CLIENT' }, removed=[];
  const service = createFileService({ repository:{}, storage:{ save:async()=>{},remove:async key=>removed.push(key) },
    transaction:async operation => operation({ lockActor:async()=>actor,countOwn:async()=>0,insert:async()=>{ throw new Error('DB failed'); } }) });
  await assert.rejects(service.upload(actor,{ originalname:'x.txt',mimetype:'text/plain',buffer:Buffer.from('text') }));
  assert.equal(removed.length,1); assert.match(removed[0],/^[a-f0-9-]{36}\.txt$/);
});

test('failed physical deletion keeps its durable tombstone and retries without exposing details',async () => {
  let fail=true,finished=0; const logs=[];
  const service=createFileService({ repository:{ pendingDeletes:async()=>[{ id:'id',storage_key:'safe.txt' }],finishDelete:async()=>finished++ },
    storage:{ remove:async()=>{ if(fail) throw new Error('/private/path'); } },logger:{ error:value=>logs.push(value) } });
  await service.drainDeletes(); assert.equal(finished,0); assert(!logs.join('').includes('/private/path'));
  fail=false; await service.drainDeletes(); assert.equal(finished,1);
});

test('portfolio validates safe links, content limits, distinct attachments and whitelist fields',() => {
  const valid={ title:' Работа ',description:'Описание\nпроекта',links:['https://example.org/demo'] };
  assert.equal(portfolioInput(valid).title,'Работа'); assert.deepEqual(portfolioInput(valid).fileIds,[]);
  for(const patch of [{ title:'' },{ description:'x'.repeat(5001) },{ links:['javascript:alert(1)'] },{ links:['https://user:password@example.org'] },
    { links:['file:///etc/passwd'] },{ fileIds:['bad'] },{ userId:'other' },{ storageKey:'../x' }]) assert.throws(()=>portfolioInput({ ...valid,...patch }));
});
