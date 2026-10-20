import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {loadConfig} from '../../src/config/env.js';import {createDatabasePool} from '../../src/config/database.js';import {marketplace} from '../helpers/marketplace.js';
if(process.env.WORKIFY_DB_TESTS!=='1')throw new Error('Use disposable infrastructure');
const config=loadConfig({...process.env,NODE_ENV:'test'}),pool=createDatabasePool(config.database);after(()=>pool.end());
const expect=(r,status)=>{assert.equal(r.response.status,status,JSON.stringify(r.body));return r.body;};
test('only the author can edit or remove a NEW complaint and admin claim freezes it',async context=>{
 const app=await marketplace(context,pool,config),a=await app.register(),b=await app.register(),admin=await app.register();await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[admin.id]);
 const order=await app.order(a,b);expect(await app.api(a,`/orders/${order.id}/cancel`,'POST',{reason:'Завершили сотрудничество'}),200);
 const create=()=>app.api(a,`/orders/${order.id}/complaints`,'POST',{reason:'Причина',description:'Описание'});
 let complaint=expect(await create(),201).complaint;
 expect(await app.api(b,`/me/complaints/${complaint.id}`,'PUT',{reason:'Чужая',description:'Нельзя'}),404);
 const updated=expect(await app.api(a,`/me/complaints/${complaint.id}`,'PUT',{reason:'Уточнение',description:'Исправленное описание'}),200).complaint;assert.equal(updated.reason,'Уточнение');
 expect(await app.api(a,`/me/complaints/${complaint.id}`,'DELETE'),200);expect(await app.api(a,`/me/complaints/${complaint.id}`),404);
 complaint=expect(await create(),201).complaint;expect(await app.api(admin,`/admin/complaints/${complaint.id}/claim`,'POST',{}),200);
 expect(await app.api(a,`/me/complaints/${complaint.id}`,'PUT',{reason:'Поздно',description:'Рассматривается'}),409);expect(await app.api(a,`/me/complaints/${complaint.id}`,'DELETE'),409);
 assert.equal(expect(await app.api(a,`/me/complaints/${complaint.id}`),200).complaint.canEdit,false);
});
