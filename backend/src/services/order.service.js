import {AppError} from '../utils/app-error.js';
import {requireFileActor} from './file.service.js';
import {orderMode,requireOrderAction} from './order-policy.js';
function summary(row,actor){return {id:row.id,project:{id:row.project_id,status:row.project_status},
  source:row.proposal_id?{type:'proposal',id:row.proposal_id}:{type:'invitation',id:row.invitation_id},
  title:row.title_snapshot,agreedPrice:row.agreed_price,initialDeadlineAt:row.initial_deadline_at,deadlineAt:row.deadline_at,status:row.status,
  participantMode:orderMode(actor,row),isOverdue:row.is_overdue,createdAt:row.created_at,updatedAt:row.updated_at,completedAt:row.completed_at,cancelledAt:row.cancelled_at,
  customer:{id:row.customer_id,username:row.customer_username,firstName:row.customer_first_name,lastName:row.customer_last_name},
  freelancer:{id:row.freelancer_id,username:row.freelancer_username,firstName:row.freelancer_first_name,lastName:row.freelancer_last_name},
};}
export function createOrderService({repository}){return {
  async list(actor,query){requireFileActor(actor);const result=await repository.list(actor.id,query);return {...result,items:result.items.map(row=>summary(row,actor)),mode:query.mode,scope:query.scope,page:query.page,pageSize:query.pageSize};},
  async get(actor,id){requireFileActor(actor);const row=await repository.find(id,actor.id);if(!row)throw new AppError(404,'ORDER_NOT_FOUND','Заказ не найден');
    const permissions=requireOrderAction(actor,row,'read');
    return {...summary(row,actor),description:row.description_snapshot,files:row.files,permissions,cancelledBy:row.cancelled_by,cancellationReason:row.cancellation_reason,
      lastSubmission:row.last_submission_id?{id:row.last_submission_id,version:row.last_submission_version,status:row.last_submission_status,createdAt:row.last_submission_created_at}:null,
      pendingDeadlineRequest:row.pending_deadline_id?{id:row.pending_deadline_id,previousDeadlineAt:row.previous_deadline_at,proposedDeadlineAt:row.proposed_deadline_at,createdAt:row.deadline_request_created_at,isCurrent:row.deadline_request_current}:null};
  },
};}
