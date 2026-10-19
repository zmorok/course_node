export async function recordInvitationChange(repo,row,actorId,status,reason){
  await repo.audit(actorId,'INVITATION_STATUS_CHANGED','invitation',row.id,{status,reason});
  await repo.notify(row.customer_id,'INVITATION_STATUS_CHANGED',row,'Статус приглашения изменён',{status,reason});
  if(status==='EXPIRED')await repo.notify(row.freelancer_id,'INVITATION_STATUS_CHANGED',row,'Приглашение больше не актуально',{status,reason});
}
