import {createAuthRepository} from './auth.repository.js';
const account={email:'email',username:'username',role:'role',passwordHash:'password_hash'};
const profile={firstName:'first_name',lastName:'last_name',middleName:'middle_name',gender:'gender',phone:'phone',headline:'headline',description:'description',city:'city',country:'country'};
export function createAdminAccountsRepository(database){
 async function patch(table,key,id,input,map){const entries=Object.entries(map).filter(([field])=>Object.hasOwn(input,field));if(entries.length)await database.query(`UPDATE workify.${table} SET ${entries.map(([,column],i)=>`${column}=$${i+2}`).join(',')} WHERE ${key}=$1`,[id,...entries.map(([field])=>input[field])]);}
 return {
  async lockAccountChanges(){await database.query('SELECT pg_advisory_xact_lock(173204,24)');},
  async account(id){return (await database.query('SELECT * FROM workify.users WHERE id=$1',[id])).rows[0];},
  async activeAdmins(){return Number((await database.query("SELECT count(*) FROM workify.users WHERE role='ADMIN' AND deleted_at IS NULL AND (status='ACTIVE' OR blocked_until<=now())")).rows[0].count);},
  async accountInUse(id){return (await database.query("SELECT EXISTS(SELECT 1 FROM workify.orders WHERE $1 IN (customer_id,freelancer_id) AND status IN ('IN_PROGRESS','SUBMITTED','REVISION_REQUESTED')) OR EXISTS(SELECT 1 FROM workify.complaints WHERE assigned_admin_id=$1 AND status='IN_REVIEW') AS used",[id])).rows[0].used;},
  async insertAccount(input,passwordHash){const user=await createAuthRepository(database).createUser({...input,passwordHash});await this.patchAccount(user.id,input);return user.id;},
  async patchAccount(id,input){await patch('users','id',id,input,account);await patch('profiles','user_id',id,input,profile);},
  async deleteAccount(id,actorId,reason){await database.query("UPDATE workify.users SET deleted_at=clock_timestamp(),email='deleted-'||id::text||'@example.invalid',username='deleted_'||replace(id::text,'-',''),status='BLOCKED',blocked_by=$2,blocked_at=clock_timestamp(),blocked_until=NULL,block_reason=$3 WHERE id=$1",[id,actorId,reason]);await database.query("UPDATE workify.profiles SET first_name='Удалённый',last_name='пользователь',middle_name=NULL,gender=NULL,phone=NULL,headline='',description='',city=NULL,country=NULL WHERE user_id=$1",[id]);},
 };
}
