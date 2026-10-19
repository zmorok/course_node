import { AppError,ValidationError } from '../utils/app-error.js';
import { requireFileActor } from './file.service.js';
import { recordProposalChange } from './proposal-events.js';
import {activeClient as active,sourceDto} from './source-dto.js';
const missing=()=>new AppError(404,'PROPOSAL_NOT_FOUND','Отклик не найден');
const conflict=()=>new AppError(409,'PROPOSAL_STATE_CONFLICT','Отклик уже рассмотрен или отозван');
function dto(row,actor){
  const expired=row.status==='PENDING'&&row.expired;
  return {...sourceDto(row),
    canWithdraw:actor.id===row.freelancer_id&&row.status==='PENDING'&&!expired,
    canDecide:actor.id===row.customer_id&&row.status==='PENDING'&&!expired&&row.project_status==='OPEN',
  };
}
export function createProposalService({repository,transaction,assignmentService}){
  async function expire(repo,projectId){
    const rows=await repo.expire(projectId);
    for(const row of rows)await recordProposalChange(repo,row,null,'REJECTED','TERMS_EXPIRED');
    return rows.map(row=>row.id);
  }
  async function run(operation){
    try{const result=await transaction(operation);if(result?.error)throw result.error;return result;}
    catch(error){
      if(error.code==='23505')throw new AppError(409,'PROPOSAL_CONFLICT','Активный отклик или заказ уже существует');
      throw error;
    }
  }
  async function decision(actor,id,kind,reason){
    const context=await repository.proposalContext(id);
    if(!context||context[kind==='withdraw'?'freelancer_id':'customer_id']!==actor.id)throw missing();
    return run(async(repo,assignments)=>{
      const users=await repo.lockUsers([context.customer_id,context.freelancer_id]);requireFileActor(users.find(user=>user.id===actor.id));
      const project=await repo.lockProject(context.project_id),source=await repo.lockProposal(id);
      if(!project||!source||source.project_id!==project.id||source.customer_id!==context.customer_id||source.freelancer_id!==context.freelancer_id)throw missing();
      if(source.status!=='PENDING')throw conflict();
      if(kind!=='withdraw'&&project.status!=='OPEN')throw new AppError(409,'PROJECT_NOT_OPEN','Проект уже не принимает отклики');
      if(kind==='accept'&&!active(users.find(user=>user.id===source.freelancer_id)))throw new AppError(409,'COUNTERPARTY_UNAVAILABLE','Исполнитель сейчас недоступен для назначения');
      const expired=await expire(repo,project.id);
      if(expired.includes(id))return {error:new AppError(409,'PROPOSAL_EXPIRED','Предложенный срок истёк. Нужен новый отклик')};
      const current=await repo.lockProposal(id);
      if(kind==='accept')await assignmentService.acceptProposal({project,proposal:current,actor,proposals:repo,assignments});
      else{
        const status=kind==='withdraw'?'WITHDRAWN':'REJECTED',closure=kind==='withdraw'?'AUTHOR_WITHDRAWN':reason;
        await repo.decide(id,status,closure);await recordProposalChange(repo,current,actor.id,status,closure);
      }
      return dto(await repo.find(id,actor.id),actor);
    });
  }
  return {
    async create(actor,projectId,input){
      const context=await repository.projectContext(projectId);
      if(!context)throw new AppError(404,'PROJECT_NOT_FOUND','Проект не найден');
      if(context.customer_id===actor.id)throw new AppError(403,'SELF_PROPOSAL','Нельзя откликнуться на свой проект');
      return run(async(repo,assignments)=>{
        const users=await repo.lockUsers([actor.id,context.customer_id]);requireFileActor(users.find(user=>user.id===actor.id));
        const project=await repo.lockProject(projectId);
        if(!project||project.customer_id!==context.customer_id||!active(users.find(user=>user.id===context.customer_id)))throw new AppError(404,'PROJECT_NOT_FOUND','Проект не найден');
        if(project.status==='DRAFT')throw new AppError(404,'PROJECT_NOT_FOUND','Проект не найден');
        if(project.status!=='OPEN'||await assignments.blockingOrder(project.id))throw new AppError(409,'PROJECT_NOT_OPEN','Проект уже не принимает отклики');
        if(new Date(input.offeredDeadlineAt).getTime()<=Date.now())throw new ValidationError([{field:'body.offeredDeadlineAt',message:'Предложите срок в будущем'}]);
        await expire(repo,project.id);
        if(await repo.pending(project.id,actor.id))return {error:new AppError(409,'DUPLICATE_PROPOSAL','У вас уже есть ожидающий отклик на этот проект')};
        const id=await repo.create(project,actor.id,input);
        await repo.audit(actor.id,'PROPOSAL_CREATED','proposal',id,{projectId});
        await repo.notify(project.customer_id,'PROPOSAL_CREATED',projectId,id,'Получен новый отклик на проект');
        return dto(await repo.find(id,actor.id),actor);
      });
    },
    async get(actor,id){requireFileActor(actor);const row=await repository.find(id,actor.id);if(!row)throw missing();return dto(row,actor);},
    async listOwn(actor,query){requireFileActor(actor);const result=await repository.list(query,{freelancerId:actor.id,projectId:query.projectId});return {...result,items:result.items.map(row=>dto(row,actor)),page:query.page,pageSize:query.pageSize};},
    async listProject(actor,projectId,query){
      requireFileActor(actor);const project=await repository.projectContext(projectId);if(!project||project.customer_id!==actor.id)throw new AppError(404,'PROJECT_NOT_FOUND','Проект не найден');
      const result=await repository.list(query,{projectId});return {...result,items:result.items.map(row=>dto(row,actor)),page:query.page,pageSize:query.pageSize};
    },
    withdraw:(actor,id)=>decision(actor,id,'withdraw'),reject:(actor,id,reason)=>decision(actor,id,'reject',reason),accept:(actor,id)=>decision(actor,id,'accept'),
  };
}
