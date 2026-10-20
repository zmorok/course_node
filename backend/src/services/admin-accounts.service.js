import {AppError} from '../utils/app-error.js';
import {requireAdmin} from './admin-policy.js';
import {hashPassword} from '../utils/password.js';
const missing=()=>new AppError(404,'USER_NOT_FOUND','Пользователь не найден');
export function createAdminAccountsService({repository,transaction,dto}){
 async function run(actor,id,operation){requireAdmin(actor);try{return await transaction(async repo=>{
  await repo.lockAccountChanges();const users=await repo.lockUsers(id?[actor.id,id]:[actor.id]);requireAdmin(users.find(user=>user.id===actor.id));
  const target=id?await repo.account(id):null;if(id&&(!target||target.deleted_at))throw missing();
  return operation(repo,target);
 });}catch(error){if(error.code==='23505')throw new AppError(409,'ACCOUNT_EXISTS','Email или имя пользователя уже заняты');throw error;}}
 async function canChangeRole(repo,target,next){if(target.role===next)return;if(target.role==='ADMIN'&&await repo.activeAdmins()<=1)throw new AppError(409,'LAST_ADMIN','Нельзя удалить или понизить последнего администратора');if(await repo.accountInUse(target.id))throw new AppError(409,'ACCOUNT_IN_USE','Сначала завершите активные заказы или рассмотрение назначенных жалоб');}
 return {
  createUser:(actor,input)=>run(actor,null,async repo=>{const id=await repo.insertAccount(input,await hashPassword(input.password));await repo.audit(actor.id,'ADMIN_USER_CREATED','user',id,{role:input.role});return {user:dto(await repo.user(id))};}),
  updateUser:(actor,id,input)=>run(actor,id,async(repo,target)=>{if(input.role)await canChangeRole(repo,target,input.role);const before=dto(await repo.user(id)),{newPassword,...patch}=input;if(newPassword)patch.passwordHash=await hashPassword(newPassword);await repo.patchAccount(id,patch);if(newPassword||patch.role&&patch.role!==target.role||patch.email&&patch.email.toLowerCase()!==target.email.toLowerCase())await repo.revokeSessions(id);const after=dto(await repo.user(id));await repo.audit(actor.id,'ADMIN_USER_UPDATED','user',id,{fields:Object.keys(input).filter(key=>key!=='newPassword'),passwordReset:Boolean(newPassword)},{oldData:before,newData:after});return {user:after};}),
  deleteUser:(actor,id,input)=>run(actor,id,async(repo,target)=>{if(target.role==='ADMIN'&&await repo.activeAdmins()<=1)throw new AppError(409,'LAST_ADMIN','Нельзя удалить последнего администратора');if(await repo.accountInUse(id))throw new AppError(409,'ACCOUNT_IN_USE','Сначала завершите активные заказы или рассмотрение назначенных жалоб');await repo.deleteAccount(id,actor.id,input.reason);await repo.revokeSessions(id);await repo.audit(actor.id,'ADMIN_USER_DELETED','user',id,{reason:input.reason});return {removed:true};}),
 };
}
