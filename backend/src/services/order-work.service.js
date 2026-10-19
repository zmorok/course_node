import {AppError,ValidationError} from '../utils/app-error.js';
import {requireFileActor} from './file.service.js';
import {orderMode,requireOrderAction} from './order-policy.js';
const missing=()=>new AppError(404,'ORDER_NOT_FOUND','Заказ не найден');
const conflict=()=>new AppError(409,'ORDER_STATE_CONFLICT','Состояние заказа изменилось. Обновите карточку');
const expired=()=>new AppError(409,'DEADLINE_REQUEST_EXPIRED','Запрос изменения срока больше не актуален');
const deadlineInputError=()=>new ValidationError([{field:'body.proposedDeadlineAt',message:'Укажите будущий срок, отличный от текущего'}]);
async function record(repo,order,actorId,type,{submission=null,request=null,reason=null}={}){
  const metadata={...(submission?{submissionId:submission.id,version:submission.version}:{}),...(request?{requestId:request.id,previousDeadlineAt:request.previous_deadline_at,proposedDeadlineAt:request.proposed_deadline_at}:{}),...(reason?{reason}:{})};
  await repo.event(order.id,actorId,type,submission?.id??null,request?.id??null,metadata);
  await repo.audit(actorId,type,'order',order.id,{projectId:order.project_id,...metadata});
  const messages={SUBMISSION_CREATED:'Исполнитель сдал новую версию результата',REVISION_REQUESTED:'Заказчик запросил доработку результата',ORDER_COMPLETED:'Заказчик принял результат. Заказ завершён',DEADLINE_REQUESTED:'Исполнитель предложил изменить срок',DEADLINE_APPROVED:'Заказчик одобрил новый срок',DEADLINE_REJECTED:'Заказчик отклонил изменение срока',DEADLINE_EXPIRED:'Запрос изменения срока закрыт'};
  const target=['SUBMISSION_CREATED','DEADLINE_REQUESTED'].includes(type)?order.customer_id:order.freelancer_id;
  await repo.notify(target,type.startsWith('DEADLINE_')&&type!=='DEADLINE_REQUESTED'?'DEADLINE_DECIDED':type,order,messages[type],{status:type,...metadata});
}
export function createOrderWorkService({repository,orders,transaction,fileService}){
  async function read(actor,id){requireFileActor(actor);const row=await orders.find(id,actor.id);if(!row)throw missing();requireOrderAction(actor,row,'read');return row;}
  async function run(actor,id,operation){
    requireFileActor(actor);const context=await repository.context(id);if(!orderMode(actor,context))throw missing();
    try{const result=await transaction(async(repo,reads,files)=>{
      const users=await repo.lockUsers([context.customer_id,context.freelancer_id]),current=users.find(user=>user.id===actor.id);requireFileActor(current);
      const project=await repo.lockProject(context.project_id);if(!project||!await repo.lockOrder(id))throw missing();
      const row=await reads.find(id,actor.id);if(!row||row.project_id!==context.project_id||row.customer_id!==context.customer_id||row.freelancer_id!==context.freelancer_id)throw missing();
      requireOrderAction(current,row,'read');return operation(repo,reads,files,current,row,project);
    });if(result?.error)throw result.error;return result;}
    catch(error){if(error.code==='23505')throw new AppError(409,'ORDER_WORK_CONFLICT','Версия результата или ожидающий запрос уже существует');throw error;}
  }
  async function closePending(repo,order,reason){if(!order.pending_deadline_id)return;
    const request=await repo.decideDeadline(order.pending_deadline_id,null,'EXPIRED',reason);await record(repo,order,null,'DEADLINE_EXPIRED',{request,reason});
  }
  function staleReason(order){return order.status==='SUBMITTED'?'ORDER_SUBMITTED':order.status==='COMPLETED'?'ORDER_COMPLETED':order.status==='CANCELLED'?'ORDER_CANCELLED':!order.deadline_request_future?'TIME_EXPIRED':!order.deadline_request_matches?'DEADLINE_CHANGED':null;}
  function activeProject(project){if(project.status!=='IN_PROGRESS')throw conflict();}
  async function review(actor,id,submissionId,input,accept){return run(actor,id,async(repo,reads,files,current,order,project)=>{
    const submission=await repo.submission(id,submissionId);if(!submission)throw new AppError(404,'SUBMISSION_NOT_FOUND','Версия результата не найдена');
    requireOrderAction(current,order,accept?'acceptSubmission':'requestRevision');activeProject(project);
    if(submission.id!==order.last_submission_id||submission.status!=='SUBMITTED')throw new AppError(409,'SUBMISSION_NOT_CURRENT','Рассмотреть можно только последнюю нерассмотренную версию');
    if(accept){await closePending(repo,order,'ORDER_COMPLETED');await repo.reviewSubmission(submissionId,current.id,'ACCEPTED',input.comment);await repo.completeOrder(order);}
    else{await closePending(repo,order,'ORDER_SUBMITTED');await repo.reviewSubmission(submissionId,current.id,'REVISION_REQUESTED',input.comment);await repo.requestRevision(id);}
    await record(repo,order,current.id,accept?'ORDER_COMPLETED':'REVISION_REQUESTED',{submission});return {submissionId};
  });}
  return {
    async submissions(actor,id,query){await read(actor,id);return {...await repository.listSubmissions(id,query),page:query.page,pageSize:query.pageSize};},
    async deadlines(actor,id,query){await read(actor,id);return {...await repository.listDeadlines(id,query),page:query.page,pageSize:query.pageSize};},
    async submit(actor,id,input){return run(actor,id,async(repo,reads,files,current,order,project)=>{
      requireOrderAction(current,order,'submit');activeProject(project);await fileService.attachable(files,current.id,input.fileIds,[]);
      const submission=await repo.createSubmission(order,input);await repo.attachFiles(submission.id,input.fileIds);
      await closePending(repo,order,'ORDER_SUBMITTED');await repo.submitOrder(id);await record(repo,order,current.id,'SUBMISSION_CREATED',{submission});return {submissionId:submission.id,version:submission.version};
    });},
    revision:(actor,id,submissionId,input)=>review(actor,id,submissionId,input,false),
    accept:(actor,id,submissionId,input)=>review(actor,id,submissionId,input,true),
    async requestDeadline(actor,id,input){return run(actor,id,async(repo,reads,files,current,order,project)=>{
      requireOrderAction(current,order,'requestDeadline');activeProject(project);
      // Validate before expiring an older request; invalid commands have no effects.
      if(Date.parse(input.proposedDeadlineAt)<=new Date(order.server_now).getTime()||Date.parse(input.proposedDeadlineAt)===new Date(order.deadline_at).getTime())throw deadlineInputError();
      if(order.pending_deadline_id)await closePending(repo,order,staleReason(order));
      const request=await repo.createDeadline(order,input);if(!request)throw deadlineInputError();await record(repo,order,current.id,'DEADLINE_REQUESTED',{request});return {requestId:request.id};
    });},
    async decideDeadline(actor,id,requestId,input,approve){return run(actor,id,async(repo,reads,files,current,order,project)=>{
      if(orderMode(current,order)!=='customer')throw new AppError(409,'ORDER_ACTION_NOT_ALLOWED','Запрос срока рассматривает заказчик');
      const request=await repo.deadlineRequest(id,requestId);if(!request)throw new AppError(404,'DEADLINE_REQUEST_NOT_FOUND','Запрос изменения срока не найден');
      if(request.status!=='PENDING')throw new AppError(409,'DEADLINE_REQUEST_DECIDED','Запрос срока уже рассмотрен или закрыт');
      const reason=staleReason(order);if(reason){await closePending(repo,order,reason);return {error:expired()};}
      requireOrderAction(current,order,approve?'approveDeadline':'rejectDeadline');activeProject(project);
      if(approve&&!await repo.changeDeadline(id,requestId)){await closePending(repo,order,'TIME_EXPIRED');return {error:expired()};}
      await repo.decideDeadline(requestId,current.id,approve?'APPROVED':'REJECTED',input.reason);
      await record(repo,order,current.id,approve?'DEADLINE_APPROVED':'DEADLINE_REJECTED',{request,reason:input.reason});return {requestId};
    });},
  };
}
