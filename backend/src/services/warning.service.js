import {AppError,ValidationError} from '../utils/app-error.js';
import {requireFileActor} from './file.service.js';
function requireAdmin(actor){if(!actor)throw new AppError(401,'UNAUTHENTICATED','Войдите в аккаунт');if(actor.status==='BLOCKED'&&(!actor.blocked_until||new Date(actor.blocked_until)>new Date()))throw new AppError(403,'ACCOUNT_BLOCKED','Аккаунт заблокирован');if(actor.role!=='ADMIN')throw new AppError(403,'FORBIDDEN','Доступ запрещён');}
export function createWarningService({repository,transaction}){return {
  async list(actor,query){requireFileActor(actor);const data=await repository.list(actor.id,query);return {...data,items:data.items.map(row=>({id:row.moderation_action_id,warningId:row.warning_id,type:row.action_type,message:row.message??row.reason,createdAt:row.created_at,expiresAt:row.expires_at,complaintId:row.complaint_id,admin:{firstName:row.first_name,lastName:row.last_name}})),page:query.page,pageSize:query.pageSize,type:query.type??null};},
  async issue(actor,targetId,input){requireAdmin(actor);return transaction(async repo=>{const users=await repo.lockUsers([actor.id,targetId]);requireAdmin(users.find(user=>user.id===actor.id));const target=users.find(user=>user.id===targetId);if(!target||target.role!=='CLIENT')throw new AppError(404,'USER_NOT_FOUND','Клиент не найден');
    if(input.expiresAt&&new Date(input.expiresAt).getTime()<=Date.now())throw new ValidationError([{field:'body.expiresAt',message:'Укажите будущий срок предупреждения'}]);
    const result=await repo.create(actor.id,targetId,input);await repo.audit(actor.id,'WARNING_ISSUED','moderation_action',result.actionId,{targetId,warningId:result.id});await repo.notify(targetId,result.actionId);return result;
  });},
};}
