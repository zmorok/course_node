import { AppError } from '../utils/app-error.js';
import { recordProposalChange } from './proposal-events.js';
import { recordInvitationChange } from './invitation-events.js';

// Both callers own one transaction and lock users (UUID order), project, then source.
export function createAssignmentService() {
  async function accept({
    project,
    source,
    actor,
    proposals: proposalRepository,
    assignments: assignmentRepository,
    sourceRepository,
    kind,
    record,
  }) {
    if (
      project.status !== 'OPEN' ||
      source.status !== 'PENDING' ||
      !source.current ||
      (await assignmentRepository.blockingOrder(project.id))
    ) {
      throw new AppError(409, 'ORDER_CONFLICT', 'Проект уже недоступен для нового заказа');
    }

    await sourceRepository.decide(source.id, 'ACCEPTED', null);

    const orderId =
      kind === 'proposal'
        ? await assignmentRepository.createFromProposal(project, source)
        : await assignmentRepository.createFromInvitation(project, source);

    await assignmentRepository.copyFiles(project.id, orderId);
    await assignmentRepository.startProject(project.id);
    await record(sourceRepository, source, actor.id, 'ACCEPTED', null);
    for (const row of await assignmentRepository.closeOtherProposals(project.id)) {
      await recordProposalChange(
        proposalRepository,
        row,
        actor.id,
        'REJECTED',
        'OTHER_SOURCE_ACCEPTED',
      );
    }
    for (const row of await assignmentRepository.closeInvitations(project.id)) {
      await assignmentRepository.notifyInvitation(row);
      await proposalRepository.audit(actor.id, 'INVITATION_STATUS_CHANGED', 'invitation', row.id, {
        status: 'EXPIRED',
        reason: row.closure_reason,
      });
    }
    await assignmentRepository.createdEvent(orderId, actor.id);
    await proposalRepository.audit(actor.id, 'ORDER_CREATED', 'order', orderId, {
      projectId: project.id,
      [`${kind}Id`]: source.id,
    });
    await assignmentRepository.notifyOrder(project.customer_id, project.id, orderId);
    await assignmentRepository.notifyOrder(source.freelancer_id, project.id, orderId);

    return orderId;
  }

  return {
    acceptProposal: ({ proposal, ...context }) =>
      accept({
        ...context,
        source: proposal,
        sourceRepository: context.proposals,
        kind: 'proposal',
        record: recordProposalChange,
      }),

    acceptInvitation: ({ invitation, invitations: invitationRepository, ...context }) =>
      accept({
        ...context,
        source: invitation,
        sourceRepository: invitationRepository,
        kind: 'invitation',
        record: recordInvitationChange,
      }),
  };
}
