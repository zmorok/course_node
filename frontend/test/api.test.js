import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

async function client(context, responses) {
  const original = Object.fromEntries(['window', 'navigator', 'BroadcastChannel', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const events = [], calls = [], target = new EventTarget();
  target.addEventListener('workify:session-ended', event => events.push(event.detail));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    assert(next, 'Unexpected extra HTTP request');
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  };
  context.after(() => { for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  const api = await import(`../src/api.js?test=${randomUUID()}`);
  return { ...api, calls, events };
}
const problem = (status, code) => ({ status, body: { error: { code, message: code, details: [] } } });
const refresh = { status: 200, body: { user: { id: 'user-id' }, accessToken: 'fresh-access-token' } };

test('a business 403 after successful refresh preserves the current session', async context => {
  const app = await client(context, [problem(401, 'UNAUTHENTICATED'), refresh, problem(403, 'INVALID_CURRENT_PASSWORD')]);
  await assert.rejects(app.api('/me/profile', { method: 'PATCH', body: { email: 'new@example.invalid' } }), { code: 'INVALID_CURRENT_PASSWORD' });
  assert.equal(app.calls.length, 3); assert.equal(app.events.length, 0);
  assert.equal(app.calls[1].url, '/api/auth/refresh');
  assert.equal(app.calls[2].options.headers.Authorization, 'Bearer fresh-access-token');
});

test('a blocked refresh ends the local session without retrying a profile mutation', async context => {
  const app = await client(context, [problem(401, 'UNAUTHENTICATED'), problem(403, 'ACCOUNT_BLOCKED')]);
  await assert.rejects(app.api('/me/profile', { method: 'PATCH', body: { firstName: 'Имя' } }), { code: 'ACCOUNT_BLOCKED' });
  assert.equal(app.calls.length, 2); assert.deepEqual(app.events, ['ACCOUNT_BLOCKED']);
});

test('an expired request retries once and returns the successful result', async context => {
  const app = await client(context, [problem(401, 'UNAUTHENTICATED'), refresh, { status: 200, body: { profile: { firstName: 'Имя' } } }]);
  assert.deepEqual(await app.api('/me/profile'), { profile: { firstName: 'Имя' } });
  assert.equal(app.calls.length, 3); assert.equal(app.events.length, 0);
});

test('a repeated 401 after refresh ends the local session without a retry loop', async context => {
  const app = await client(context, [problem(401, 'UNAUTHENTICATED'), refresh, problem(401, 'UNAUTHENTICATED')]);
  await assert.rejects(app.api('/me/profile'), { code: 'UNAUTHENTICATED' });
  assert.equal(app.calls.length, 3); assert.deepEqual(app.events, ['UNAUTHENTICATED']);
});

test('multipart uploads retain FormData and let the browser create the boundary, including a token refresh retry',async context=>{
  const app=await client(context,[problem(401,'UNAUTHENTICATED'),refresh,{status:201,body:{file:{id:'file-id'}}}]);
  const form=new FormData();form.append('file',new Blob(['text'],{type:'text/plain'}),'notes.txt');
  assert.equal((await app.api('/files',{method:'POST',body:form})).file.id,'file-id');
  for(const call of [app.calls[0],app.calls[2]]){
    assert.equal(call.options.body,form);assert(!Object.hasOwn(call.options.headers,'Content-Type'));
    assert.equal(call.options.headers['X-Workify-Client'],'browser');
  }
  assert.equal(app.events.length,0);
});

test('binary downloads retain authorization and JSON errors still use the safe envelope',async context=>{
  const app=await client(context,[refresh,{status:200,body:'binary-content'},problem(404,'FILE_NOT_FOUND')]);
  await app.restoreSession();
  const blob=await app.api('/files/id',{responseType:'blob'});
  assert(blob instanceof Blob);assert.equal(app.calls[1].options.headers.Authorization,'Bearer fresh-access-token');
  await assert.rejects(app.api('/files/missing',{responseType:'blob'}),{code:'FILE_NOT_FOUND'});
});
