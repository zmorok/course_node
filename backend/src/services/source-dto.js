export const activeClient=user=>user?.role==='CLIENT'&&(user.status==='ACTIVE'||user.blocked_until&&new Date(user.blocked_until).getTime()<=Date.now());
export function sourceDto(row){return {id:row.id,project:{id:row.project_id,title:row.project_title,status:row.project_status},
  customer:{id:row.customer_id,username:row.customer_username,firstName:row.customer_first_name,lastName:row.customer_last_name},
  freelancer:{id:row.freelancer_id,username:row.freelancer_username,firstName:row.freelancer_first_name,lastName:row.freelancer_last_name},
  message:row.message,offeredPrice:row.offered_price,offeredDeadlineAt:row.offered_deadline_at,status:row.status,expired:row.status==='PENDING'&&row.expired,
  decidedAt:row.decided_at,closureReason:row.closure_reason,createdAt:row.created_at,updatedAt:row.updated_at,
  order:row.order_id?{id:row.order_id,status:row.order_status,title:row.title_snapshot,description:row.description_snapshot,
    agreedPrice:row.agreed_price,initialDeadlineAt:row.initial_deadline_at,deadlineAt:row.deadline_at,files:row.order_files}:null,
};}
