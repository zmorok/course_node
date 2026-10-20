import {AppError} from '../utils/app-error.js';
function requireActor(actor) {
  if(!actor)throw new AppError(401,'UNAUTHENTICATED','Войдите в аккаунт');
  if(actor.status==='BLOCKED'&&(!actor.blocked_until||new Date(actor.blocked_until)>new Date()))throw new AppError(403,'ACCOUNT_BLOCKED','Аккаунт заблокирован');
}
function dto(row) {
  const href=row.moderation_action_id?'/me/warnings':row.complaint_id?`/me/complaints/${row.complaint_id}`:row.order_id?`/orders/${row.order_id}`:row.invitation_id?'/me/invitations':row.proposal_id?(row.event_type==='PROPOSAL_CREATED'?`/projects/${row.project_id}`:'/me/proposals'):row.project_id?`/projects/${row.project_id}`:null;
  return {id:row.id,type:row.event_type,message:row.message,createdAt:new Date(row.created_at).toISOString(),readAt:row.read_at?new Date(row.read_at).toISOString():null,href};
}
export function createNotificationService({repository}) {
  return {
    async list(actor,query){requireActor(actor);const result=await repository.list(actor.id,query);return {items:result.items.map(dto),total:result.total,unreadCount:result.unread_count,page:query.page,pageSize:query.pageSize};},
    async unread(actor){requireActor(actor);return {unreadCount:await repository.unread(actor.id)};},
    async markRead(actor,id){requireActor(actor);const row=await repository.markRead(actor.id,id);if(!row)throw new AppError(404,'NOTIFICATION_NOT_FOUND','Уведомление не найдено');return {id:row.id,readAt:row.read_at};},
    async markAllRead(actor){requireActor(actor);return {updated:await repository.markAllRead(actor.id)};},
  };
}
