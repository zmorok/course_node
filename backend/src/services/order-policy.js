import {AppError} from '../utils/app-error.js';
import {activeClient} from './source-dto.js';
import {requireFileActor} from './file.service.js';
const activeStatuses=new Set(['IN_PROGRESS','SUBMITTED','REVISION_REQUESTED']);
export function orderMode(actor,order){if(!actor?.id||!order)return null;return actor.id===order.customer_id?'customer':actor.id===order.freelancer_id?'freelancer':null;}
// Domain permissions are independent of a selected list mode or UI controls.
// Each future command must re-read its context under locks and call this guard.
export function orderPermissions(actor,order){
  const mode=orderMode(actor,order),read=Boolean(mode&&activeClient(actor));
  const working=read&&['IN_PROGRESS','REVISION_REQUESTED'].includes(order.status);
  const review=read&&mode==='customer'&&order.status==='SUBMITTED'&&order.last_submission_status==='SUBMITTED'&&Boolean(order.last_submission_id);
  const deadline=working&&mode==='customer'&&Boolean(order.pending_deadline_id)&&order.deadline_request_current===true;
  return {read,submit:working&&mode==='freelancer',requestDeadline:working&&mode==='freelancer'&&!order.deadline_request_current,
    acceptSubmission:review,requestRevision:review,approveDeadline:deadline,rejectDeadline:deadline,cancel:read&&activeStatuses.has(order.status)};
}
export function requireOrderAction(actor,order,action){
  requireFileActor(actor);const permissions=orderPermissions(actor,order);
  if(!permissions.read)throw new AppError(404,'ORDER_NOT_FOUND','Заказ не найден');
  if(!Object.hasOwn(permissions,action)||permissions[action]!==true)throw new AppError(409,'ORDER_ACTION_NOT_ALLOWED','Действие недоступно в текущем состоянии заказа');
  return permissions;
}
