import {AppError} from '../utils/app-error.js';
import {fileDto,requireFileActor} from './file.service.js';
import {orderMode} from './order-policy.js';
const missingOrder=()=>new AppError(404,'ORDER_NOT_FOUND','Заказ не найден');
const terminal=order=>['COMPLETED','CANCELLED'].includes(order.status);
const duplicate=()=>new AppError(409,'COMPLAINT_ALREADY_EXISTS','Ваша жалоба по этому заказу уже подана');
const dto=row=>({id:row.id,order:{id:row.order_id,title:row.title_snapshot,status:row.order_status},target:{id:row.target_id,firstName:row.target_first_name,lastName:row.target_last_name},participantMode:row.reporter_id===row.customer_id?'customer':'freelancer',reason:row.reason,description:row.description,status:row.status,createdAt:row.created_at,claimedAt:row.claimed_at,resolvedAt:row.resolved_at,resolutionNote:row.resolution_note,files:row.files.map(fileDto)});
export function createComplaintService({repository,transaction,fileService}){return {
  async order(actor,id){requireFileActor(actor);const order=await repository.context(id);if(!order||!orderMode(actor,order))throw missingOrder();const own=await repository.ownForOrder(id,actor.id);return {complaint:own?dto(own):null,canComplain:terminal(order)&&!own,recipientId:actor.id===order.customer_id?order.freelancer_id:order.customer_id};},
  async create(actor,id,input){requireFileActor(actor);const context=await repository.context(id);if(!context||!orderMode(actor,context))throw missingOrder();
    try{return await transaction(async(repo,files)=>{const users=await repo.lockUsers([context.customer_id,context.freelancer_id]);requireFileActor(users.find(user=>user.id===actor.id));const project=await repo.lockProject(context.project_id),order=await repo.lockOrder(id);
      if(!project||!order||!orderMode(actor,order)||order.project_id!==context.project_id||order.customer_id!==context.customer_id||order.freelancer_id!==context.freelancer_id)throw missingOrder();
      if(!terminal(order))throw new AppError(409,'COMPLAINT_ORDER_NOT_TERMINAL','Жалоба доступна после завершения или отмены заказа');
      if(await repo.ownForOrder(id,actor.id))throw duplicate();await fileService.attachable(files,actor.id,input.fileIds);
      const complaintId=await repo.create(order,actor.id,input);await repo.attach(complaintId,input.fileIds);await repo.audit(actor.id,'COMPLAINT_CREATED','complaint',complaintId,{orderId:id,targetId:actor.id===order.customer_id?order.freelancer_id:order.customer_id});return dto(await repo.own(complaintId,actor.id));
    });}catch(error){if(error.code==='23505')throw duplicate();throw error;}
  },
  async list(actor,query){requireFileActor(actor);const data=await repository.list(actor.id,query);return {...data,items:data.items.map(dto),mode:query.mode,status:query.status??null,page:query.page,pageSize:query.pageSize};},
  async own(actor,id){requireFileActor(actor);const row=await repository.own(id,actor.id);if(!row)throw new AppError(404,'COMPLAINT_NOT_FOUND','Жалоба не найдена');return dto(row);},
};}
