import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {loadConfig} from '../../src/config/env.js';import {createDatabasePool} from '../../src/config/database.js';import {marketplace} from '../helpers/marketplace.js';
if(process.env.WORKIFY_DB_TESTS!=='1')throw new Error('Use disposable infrastructure');
const config=loadConfig({...process.env,NODE_ENV:'test'}),pool=createDatabasePool(config.database);after(()=>pool.end());
const expect=(r,status)=>{assert.equal(r.response.status,status,JSON.stringify(r.body));return r.body;};
test('admin creates edits resets credentials assigns roles and deletes accounts while preserving history',async context=>{
 const app=await marketplace(context,pool,config),admin=await app.register(),client=await app.register();await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[admin.id]);
 const input={email:`${randomUUID()}@example.invalid`,username:`u_${randomUUID().replaceAll('-','')}`,password:'created account password',firstName:'Новый',lastName:'Пользователь',role:'CLIENT'};
 expect(await app.api(client,'/admin/users','POST',input),403);
 const created=expect(await app.api(admin,'/admin/users','POST',input),201).user;
 const login=expect(await app.api(null,'/auth/login','POST',{email:input.email,password:input.password}),200);
 const edited=expect(await app.api(admin,`/admin/users/${created.id}`,'PATCH',{middleName:'Иванович',gender:'Male',role:'ADMIN',newPassword:'reset account password'}),200).user;
 assert.equal(edited.middleName,'Иванович');assert.equal(edited.role,'ADMIN');expect(await app.api({token:login.accessToken},'/auth/me'),401);
 expect(await app.api(admin,`/admin/users/${created.id}`,'PATCH',{role:'CLIENT'}),200);
 const order=await app.order(client,await app.register());expect(await app.api(admin,`/admin/users/${client.id}`,'DELETE',{reason:'Проверка активного заказа'}),409);
 expect(await app.api(client,`/orders/${order.id}/cancel`,'POST',{reason:'Закончили'}),200);
 expect(await app.api(admin,`/admin/users/${client.id}`,'DELETE',{reason:'Удаление аккаунта'}),200);expect(await app.api(client,'/auth/me'),401);expect(await app.api(null,`/users/${client.id}`),404);
 assert.equal((await pool.query('SELECT count(*) FROM workify.orders WHERE customer_id=$1',[client.id])).rows[0].count,'1');
 expect(await app.api(admin,`/admin/users/${created.id}`,'DELETE',{reason:'Тест завершён'}),200);
});
test('the last active administrator cannot be demoted or deleted',async()=>{
 const {createAdminAccountsService}=await import('../../src/services/admin-accounts.service.js');
 const actor={id:'last-admin',role:'ADMIN',status:'ACTIVE'},repo={lockAccountChanges:async()=>{},lockUsers:async()=>[actor],account:async()=>actor,activeAdmins:async()=>1};
 const service=createAdminAccountsService({repository:repo,transaction:operation=>operation(repo),dto:value=>value});
 await assert.rejects(service.updateUser(actor,actor.id,{role:'CLIENT'}),{code:'LAST_ADMIN'});
 await assert.rejects(service.deleteUser(actor,actor.id,{reason:'Нельзя'}),{code:'LAST_ADMIN'});
});
