export async function recordProposalChange(repository,row,actorId,status,reason){
  await repository.audit(actorId,'PROPOSAL_STATUS_CHANGED','proposal',row.id,{status,reason});
  await repository.notify(row.freelancer_id,'PROPOSAL_STATUS_CHANGED',row.project_id,row.id,'Статус вашего отклика изменён',{status,reason});
  if(status==='WITHDRAWN')await repository.notify(row.customer_id,'PROPOSAL_STATUS_CHANGED',row.project_id,row.id,'Исполнитель отозвал отклик',{status});
}
