import { AppError } from '../utils/app-error.js';
import { recordProposalChange } from './proposal-events.js';
import {recordInvitationChange} from './invitation-events.js';

// Both callers own one transaction and lock users (UUID order), project, then source.
export function createAssignmentService(){
    async function accept({project,source,actor,proposals,assignments,sourceRepository,kind,record}){
      if(project.status!=='OPEN'||source.status!=='PENDING'||!source.current||await assignments.blockingOrder(project.id))throw new AppError(409,'ORDER_CONFLICT','Проект уже недоступен для нового заказа');
      await sourceRepository.decide(source.id,'ACCEPTED',null);
      const orderId=kind==='proposal'?await assignments.createFromProposal(project,source):await assignments.createFromInvitation(project,source);
      await assignments.copyFiles(project.id,orderId);await assignments.startProject(project.id);
      await record(sourceRepository,source,actor.id,'ACCEPTED',null);
      for(const row of await assignments.closeOtherProposals(project.id))await recordProposalChange(proposals,row,actor.id,'REJECTED','OTHER_SOURCE_ACCEPTED');
      for(const row of await assignments.closeInvitations(project.id)){
        await assignments.notifyInvitation(row);await proposals.audit(actor.id,'INVITATION_STATUS_CHANGED','invitation',row.id,{status:'EXPIRED',reason:row.closure_reason});
      }
      await assignments.createdEvent(orderId,actor.id);
      await proposals.audit(actor.id,'ORDER_CREATED','order',orderId,{projectId:project.id,[`${kind}Id`]:source.id});
      await assignments.notifyOrder(project.customer_id,project.id,orderId);await assignments.notifyOrder(source.freelancer_id,project.id,orderId);
      return orderId;
    }
  return {
    acceptProposal:({proposal,...context})=>accept({...context,source:proposal,sourceRepository:context.proposals,kind:'proposal',record:recordProposalChange}),
    acceptInvitation:({invitation,invitations,...context})=>accept({...context,source:invitation,sourceRepository:invitations,kind:'invitation',record:recordInvitationChange}),
  };
}
