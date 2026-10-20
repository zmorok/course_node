import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {loadConfig} from '../../src/config/env.js';import {createDatabasePool} from '../../src/config/database.js';import {marketplace} from '../helpers/marketplace.js';
if(process.env.WORKIFY_DB_TESTS!=='1')throw new Error('Use disposable infrastructure');
const config=loadConfig({...process.env,NODE_ENV:'test'}),pool=createDatabasePool(config.database);after(()=>pool.end());
const expect=(r,status)=>{assert.equal(r.response.status,status,JSON.stringify(r.body));return r.body;};
test('audit JSON export and WPF import preserve immutable native events deduplicate and strip credentials',async context=>{
 const app=await marketplace(context,pool,config),admin=await app.register(),client=await app.register();await pool.query("UPDATE workify.users SET role='ADMIN' WHERE id=$1",[admin.id]);
 expect(await app.api(client,'/admin/audit/export'),403);
 const exported=expect(await app.api(admin,`/admin/audit/export?actorId=${client.id}`),200);assert.equal(exported.format,'workify-audit');assert(exported.entries.length>0);assert(!JSON.stringify(exported).includes('password_hash'));
 async function upload(actor,data){const form=new FormData();form.append('file',new Blob([JSON.stringify(data)],{type:'application/json'}),'audit.json');return app.request('/api/admin/audit/import',{method:'POST',headers:{Authorization:`Bearer ${actor.token}`},body:form});}
 expect(await upload(client,exported),403);
 const result=expect(await upload(admin,exported),200);assert(result.imported>0);assert.equal(expect(await upload(admin,exported),200).imported,0);
 const legacy=[{id:123,user_id:42,proc_name:'core.old_action',action:'UPDATE',table_name:'users',changed_at:'2025-05-01T12:00:00Z',old_data:{password:'private',name:'Прежнее'},new_data:{token:'private',name:'Новое'}}];
 assert.equal(expect(await upload(admin,legacy),200).imported,1);expect(await upload(admin,[...legacy,{action:'invalid'}]),422);
 const archived=expect(await app.api(admin,'/admin/audit/imported?pageSize=24'),200);const row=archived.items.find(item=>item.original_data.id===123);assert(row);assert(!JSON.stringify(row).includes('private'));assert.equal(row.original_data.new_data.name,'Новое');
 await assert.rejects(pool.query("UPDATE workify.audit_imported_entries SET original_data='{}' WHERE id=$1",[row.id]),{code:'23514'});
 const native=(await pool.query('SELECT action FROM workify.audit_logs WHERE actor_id=$1',[client.id])).rows;assert(native.some(item=>item.action==='AUTH_REGISTERED'));
});
