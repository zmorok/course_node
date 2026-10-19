import { AppError } from '../utils/app-error.js';
import { recordProposalChange } from './proposal-events.js';

// The caller owns the transaction and locks users (UUID order), project, then source.
// The invitation acceptance path can reuse this transaction boundary in its stage.
export function createAssignmentService(){
  return {
    async acceptProposal({project,proposal,actor,proposals,assignments}){
      if(project.status!=='OPEN'||proposal.status!=='PENDING'||!proposal.current||await assignments.blockingOrder(project.id))throw new AppError(409,'ORDER_CONFLICT','Проект уже недоступен для нового заказа');
      await proposals.decide(proposal.id,'ACCEPTED',null);
      const orderId=await assignments.createFromProposal(project,proposal);
      await assignments.copyFiles(project.id,orderId);await assignments.startProject(project.id);
      await recordProposalChange(proposals,proposal,actor.id,'ACCEPTED',null);
      for(const row of await assignments.closeOtherProposals(project.id))await recordProposalChange(proposals,row,actor.id,'REJECTED','OTHER_SOURCE_ACCEPTED');
      for(const row of await assignments.closeInvitations(project.id)){
        await assignments.notifyInvitation(row);await proposals.audit(actor.id,'INVITATION_STATUS_CHANGED','invitation',row.id,{status:'EXPIRED',reason:row.closure_reason});
      }
      await assignments.createdEvent(orderId,actor.id);
      await proposals.audit(actor.id,'ORDER_CREATED','order',orderId,{projectId:project.id,proposalId:proposal.id});
      await assignments.notifyOrder(project.customer_id,project.id,orderId);await assignments.notifyOrder(proposal.freelancer_id,project.id,orderId);
      return orderId;
    },
  };
}
