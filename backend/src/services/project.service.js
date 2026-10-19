import { AppError, ValidationError } from '../utils/app-error.js';
import { requireFileActor } from './file.service.js';
const missing = () => new AppError(404,'PROJECT_NOT_FOUND','Проект не найден');
const conflict = () => new AppError(409,'PROJECT_STATE_CONFLICT','Действие недоступно в текущем состоянии проекта');
const sameIds = (a,b) => a.length === b.length && a.every(id=>b.includes(id));
const iso = value => value ? new Date(value).toISOString() : null;
function dto(row,actor) {
  const own = row.customer_id === actor?.id;
  return { id:row.id,title:row.title,description:row.description,status:row.status,
    category:row.category_id ? {id:row.category_id,slug:row.category_slug,name:row.category_name} : null,
    budget:row.budget,desiredDeadlineAt:row.desired_deadline_at,skills:row.skills,files:row.files,
    customer:{id:row.customer_id,username:row.username,firstName:row.first_name,lastName:row.last_name},
    isOwn:own,acceptsProposals:row.status==='OPEN'&&row.customer_active,createdAt:row.created_at,updatedAt:row.updated_at,publishedAt:row.published_at,
    ...(own?{cancelledAt:row.cancelled_at,cancellationReason:row.cancellation_reason,completedAt:row.completed_at}:{}) };
}
function requireFuture(value) {
  if(value && new Date(value).getTime()<=Date.now()) throw new ValidationError([{field:'body.desiredDeadlineAt',message:'Желаемый срок должен быть в будущем'}]);
}
export function createProjectService({repository,transaction,fileService}) {
  async function references(repo,input) {
    const valid=await repo.validReferences(input.categoryId,input.skillIds),issues=[];
    if(!valid.category)issues.push({field:'body.categoryId',message:'Выберите категорию из справочника'});
    if(!valid.skills)issues.push({field:'body.skillIds',message:'Выберите навыки из справочника'});
    if(issues.length)throw new ValidationError(issues);
  }
  async function mutable(repo,row) {
    if(!['DRAFT','OPEN'].includes(row.status) || await repo.blockingOrder(row.id))throw conflict();
  }
  async function ownOperation(actor,id,operation) {
    const result=await transaction(async(repo,files)=>{
      requireFileActor(await files.lockActor(actor.id));
      const row=await repo.lockOwn(id,actor.id);if(!row)throw missing();
      return operation(repo,files,row);
    });
    await fileService.drainDeletes();return result;
  }
  async function applyPatch(repo,files,row,actor,patch) {
    await mutable(repo,row);
    const beforeSkills=await repo.skills(row.id),beforeFiles=await repo.files(row.id);
    const before={title:row.title,description:row.description,categoryId:row.category_id,budget:row.budget,
      desiredDeadlineAt:iso(row.desired_deadline_at),skillIds:beforeSkills,fileIds:beforeFiles};
    const next={...before,...patch};
    if(Object.hasOwn(patch,'desiredDeadlineAt') && next.desiredDeadlineAt!==before.desiredDeadlineAt)requireFuture(next.desiredDeadlineAt);
    if(row.status==='OPEN' && (!next.categoryId || !next.description.trim()))throw new ValidationError([{field:'body',message:'У опубликованного проекта должны быть категория и описание'}]);
    await references(repo,next);
    await fileService.attachable(files,actor.id,next.fileIds,beforeFiles);
    const changed=['title','description','categoryId','budget','desiredDeadlineAt'].some(key=>before[key]!==next[key])
      || !sameIds(beforeSkills,next.skillIds) || !sameIds(beforeFiles,next.fileIds);
    if(changed) {
      if(row.status==='OPEN')await repo.closePending(row.id,'TERMS_CHANGED');
      await repo.update(row.id,next);await repo.replaceSkills(row.id,next.skillIds);await repo.replaceFiles(row.id,next.fileIds);
      await files.markUnusedDeleted(beforeFiles.filter(id=>!next.fileIds.includes(id)));
    }
    return dto(await repo.findVisible(row.id,actor.id),actor);
  }
  return {
    async categories(){return repository.categories();},
    async list(query,actor,mine=false){
      if(mine)requireFileActor(actor);
      const result=await repository.list(query,mine?actor.id:undefined);
      return {items:result.items.map(row=>dto(row,actor)),total:result.total,page:query.page,pageSize:query.pageSize};
    },
    async get(id,actor){const row=await repository.findVisible(id,actor?.id);if(!row)throw missing();return dto(row,actor);},
    async create(actor,input){
      return transaction(async(repo,files)=>{
        requireFileActor(await files.lockActor(actor.id));requireFuture(input.desiredDeadlineAt);
        if(await repo.countOwn(actor.id)>=100)throw new AppError(409,'PROJECT_QUOTA','Можно создать не более 100 проектов');
        await references(repo,input);await fileService.attachable(files,actor.id,input.fileIds);
        const id=await repo.insert(actor.id,input);await repo.replaceSkills(id,input.skillIds);await repo.replaceFiles(id,input.fileIds);
        return dto(await repo.findVisible(id,actor.id),actor);
      });
    },
    async patch(actor,id,input){return ownOperation(actor,id,(repo,files,row)=>applyPatch(repo,files,row,actor,input));},
    async publish(actor,id){return ownOperation(actor,id,async(repo,_files,row)=>{
      if(row.status!=='DRAFT')throw conflict();await mutable(repo,row);
      if(!row.description.trim() || !row.category_id)throw new ValidationError([{field:'body',message:'Для публикации заполните описание и категорию'}]);
      requireFuture(row.desired_deadline_at);await repo.publish(id);return dto(await repo.findVisible(id,actor.id),actor);
    });},
    async cancel(actor,id,reason){return ownOperation(actor,id,async(repo,_files,row)=>{
      await mutable(repo,row);await repo.closePending(id,'PROJECT_CANCELLED');await repo.cancel(id,reason);
      return dto(await repo.findVisible(id,actor.id),actor);
    });},
    async remove(actor,id){return ownOperation(actor,id,async(repo,files,row)=>{
      if(row.status!=='DRAFT' || await repo.hasHistory(id))throw conflict();
      const ids=await repo.files(id);await repo.remove(id);await files.markUnusedDeleted(ids);
    });},
    async attachFile(actor,id,fileId){return ownOperation(actor,id,async(repo,files,row)=>{
      const ids=await repo.files(id);
      if(ids.includes(fileId))throw new AppError(409,'FILE_IN_USE','Файл уже прикреплён к проекту');
      if(ids.length>=8)throw new AppError(422,'PROJECT_FILE_LIMIT','Можно прикрепить не более 8 файлов');
      return applyPatch(repo,files,row,actor,{fileIds:[...ids,fileId]});
    });},
    async detachFile(actor,id,fileId){return ownOperation(actor,id,async(repo,files,row)=>{
      const ids=await repo.files(id);if(!ids.includes(fileId))throw missing();
      return applyPatch(repo,files,row,actor,{fileIds:ids.filter(value=>value!==fileId)});
    });},
  };
}
