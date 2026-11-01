export async function recordInvitationChange(transactionRepository, row, actorId, status, reason) {
  await transactionRepository.audit(actorId, 'INVITATION_STATUS_CHANGED', 'invitation', row.id, {
    status,
    reason,
  });
  await transactionRepository.notify(
    row.customer_id,
    'INVITATION_STATUS_CHANGED',
    row,
    'Статус приглашения изменён',
    { status, reason },
  );

  if (status === 'EXPIRED') {
    await transactionRepository.notify(
      row.freelancer_id,
      'INVITATION_STATUS_CHANGED',
      row,
      'Приглашение больше не актуально',
      { status, reason },
    );
  }
}
