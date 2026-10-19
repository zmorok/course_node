import {AppError,ValidationError} from '../utils/app-error.js';
import {requireFileActor} from './file.service.js';
import {activeClient,sourceDto} from './source-dto.js';
import {recordInvitationChange} from './invitation-events.js';
import {recordProposalChange} from './proposal-events.js';
const missing=()=>new AppError(404,'INVITATION_NOT_FOUND','Приглашение не найдено');
function dto(row,actor){const value=sourceDto(row);return {...value,expiresAt:row.expires_at,canRespond:actor.id===row.freelancer_id&&row.status==='PENDING'&&!value.expired&&row.project_status==='OPEN'};}
export function createInvitationService({repository,transaction,assignmentService}){
  async function expire(repo,proposals,projectId){
    const rows=await repo.expire(projectId);for(const row of rows)await recordInvitationChange(repo,row,null,'EXPIRED',row.closure_reason);
    for(const row of await proposals.expire(projectId))await recordProposalChange(proposals,row,null,'REJECTED','TERMS_EXPIRED');
    return rows.map(row=>row.id);
  }
  async function run(operation){try{const result=await transaction(operation);if(result?.error)throw result.error;return result;}catch(error){if(error.code==='23505')throw new AppError(409,'INVITATION_CONFLICT','Ожидающее приглашение или заказ уже существует');throw error;}}
  async function decision(actor,id,kind,reason){
    const context=await repository.context(id);if(!context||context.freelancer_id!==actor.id)throw missing();
    return run(async(repo,assignments,proposals)=>{
      const users=await repo.lockUsers([context.customer_id,context.freelancer_id]);requireFileActor(users.find(user=>user.id===actor.id));
      const project=await repo.lockProject(context.project_id),source=await repo.lockInvitation(id);
      if(!project||!source||source.customer_id!==context.customer_id||source.freelancer_id!==actor.id||source.project_id!==project.id)throw missing();
      if(source.status!=='PENDING')throw new AppError(409,'INVITATION_STATE_CONFLICT','Приглашение уже рассмотрено или закрыто');
      if(project.status!=='OPEN')throw new AppError(409,'PROJECT_NOT_OPEN','Проект уже недоступен для приглашения');
      if(kind==='accept'&&!activeClient(users.find(user=>user.id===source.customer_id)))throw new AppError(409,'COUNTERPARTY_UNAVAILABLE','Заказчик сейчас недоступен для назначения');
      if((await expire(repo,proposals,project.id)).includes(id))return {error:new AppError(409,'INVITATION_EXPIRED','Срок приглашения или предложенные условия истекли')};
      const current=await repo.lockInvitation(id);
      if(kind==='accept')await assignmentService.acceptInvitation({project,invitation:current,actor,invitations:repo,proposals,assignments});
      else{await repo.decide(id,'DECLINED',reason);await recordInvitationChange(repo,current,actor.id,'DECLINED',reason);}
      return dto(await repo.find(id,actor.id),actor);
    });
  }
  return {
    async availableProjects(actor,freelancerId){requireFileActor(actor);if(actor.id===freelancerId)throw new AppError(403,'SELF_INVITATION','Нельзя пригласить себя');if(!await repository.candidate(freelancerId))throw new AppError(404,'PROFILE_NOT_FOUND','Профиль не найден');return (await repository.availableProjects(actor.id,freelancerId)).map(row=>({id:row.id,title:row.title,budget:row.budget,desiredDeadlineAt:row.desired_deadline_at}));},
    async create(actor,projectId,input){
      const context=await repository.projectContext(projectId);if(!context||context.customer_id!==actor.id)throw new AppError(404,'PROJECT_NOT_FOUND','Проект не найден');
      if(actor.id===input.freelancerId)throw new AppError(403,'SELF_INVITATION','Нельзя пригласить себя');
      return run(async(repo,assignments,proposals)=>{
        const users=await repo.lockUsers([actor.id,input.freelancerId]);requireFileActor(users.find(user=>user.id===actor.id));
        const project=await repo.lockProject(projectId);if(!project||project.customer_id!==actor.id)throw new AppError(404,'PROJECT_NOT_FOUND','Проект не найден');
        if(!activeClient(users.find(user=>user.id===input.freelancerId)))throw new AppError(404,'PROFILE_NOT_FOUND','Профиль не найден');
        if(project.status!=='OPEN'||await assignments.blockingOrder(project.id))throw new AppError(409,'PROJECT_NOT_OPEN','Проект уже недоступен для приглашения');
        const issues=[];for(const [field,value] of [['offeredDeadlineAt',input.offeredDeadlineAt],['expiresAt',input.expiresAt]])if(value&&new Date(value).getTime()<=Date.now())issues.push({field:`body.${field}`,message:'Укажите дату и время в будущем'});if(issues.length)throw new ValidationError(issues);
        await expire(repo,proposals,project.id);
        if(await repo.pending(project.id,input.freelancerId))return {error:new AppError(409,'DUPLICATE_INVITATION','Этот исполнитель уже получил ожидающее приглашение на проект')};
        const id=await repo.create(project,input),row={id,project_id:project.id};
        await repo.audit(actor.id,'INVITATION_CREATED','invitation',id,{projectId:project.id});
        await repo.notify(input.freelancerId,'INVITATION_CREATED',row,'Вас пригласили выполнить проект');return dto(await repo.find(id,actor.id),actor);
      });
    },
    async get(actor,id){requireFileActor(actor);const row=await repository.find(id,actor.id);if(!row)throw missing();return dto(row,actor);},
    async listOwn(actor,query){requireFileActor(actor);const result=await repository.list(query,{[query.box==='sent'?'customerId':'freelancerId']:actor.id,projectId:query.projectId});return {...result,items:result.items.map(row=>dto(row,actor)),page:query.page,pageSize:query.pageSize};},
    async listProject(actor,projectId,query){requireFileActor(actor);const project=await repository.projectContext(projectId);if(!project||project.customer_id!==actor.id)throw new AppError(404,'PROJECT_NOT_FOUND','Проект не найден');const result=await repository.list(query,{projectId});return {...result,items:result.items.map(row=>dto(row,actor)),page:query.page,pageSize:query.pageSize};},
    accept:(actor,id)=>decision(actor,id,'accept'),decline:(actor,id,reason)=>decision(actor,id,'decline',reason),
  };
}
