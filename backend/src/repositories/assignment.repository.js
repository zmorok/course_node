import { databaseNow, date, plain, blockingStatuses } from './database-tools.js';

export function createAssignmentRepository(database) {
  // создание заказа со снимком условий проекта и данными принятого предложения
  async function create(project, source, column) {
    return (
      await database.orders.create({
        data: {
          project_id: project.id,
          customer_id: project.customer_id,
          freelancer_id: source.freelancer_id,
          [column]: source.id,
          title_snapshot: project.title,
          description_snapshot: project.description,
          agreed_price: source.offered_price,
          initial_deadline_at: date(source.offered_deadline_at),
          deadline_at: date(source.offered_deadline_at),
        },
      })
    ).id;
  }

  return {
    // метод проверки наличия активного или завершённого заказа по проекту
    async blockingOrder(projectId) {
      return Boolean(
        await database.orders.findFirst({
          where: { project_id: projectId, status: { in: blockingStatuses } },
          select: { id: true },
        }),
      );
    },

    // метод создания заказа на основе принятого отклика
    createFromProposal: (project, source) => create(project, source, 'proposal_id'),

    // метод создания заказа на основе принятого приглашения
    createFromInvitation: (project, source) => create(project, source, 'invitation_id'),

    // метод копирования связей вложений проекта в снимок заказа
    async copyFiles(projectId, orderId) {
      const rows = await database.project_files.findMany({ where: { project_id: projectId } });

      if (rows.length)
        await database.order_files.createMany({
          data: rows.map((row) => ({ order_id: orderId, file_id: row.file_id })),
        });
    },

    // метод перевода проекта в состояние выполнения
    async startProject(id) {
      await database.projects.updateMany({ where: { id }, data: { status: 'IN_PROGRESS' } });
    },

    // метод отклонения остальных ожидающих откликов после назначения исполнителя
    async closeOtherProposals(projectId) {
      return plain(
        await database.proposals.updateManyAndReturn({
          where: { project_id: projectId, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            closure_reason: 'OTHER_SOURCE_ACCEPTED',
            decided_at: await databaseNow(database),
          },
        }),
      );
    },

    // метод закрытия ожидающих приглашений с выбором причины завершения
    async closeInvitations(projectId) {
      const now = await databaseNow(database);
      const rows = [];

      for (const [where, reason] of [
        [{ offered_deadline_at: { lte: now } }, 'TERMS_EXPIRED'],
        [{ expires_at: { lte: now } }, 'TIME_EXPIRED'],
        [{}, 'OTHER_SOURCE_ACCEPTED'],
      ])
        rows.push(
          ...(await database.project_invitations.updateManyAndReturn({
            where: { project_id: projectId, status: 'PENDING', ...where },
            data: { status: 'EXPIRED', closure_reason: reason, decided_at: now },
          })),
        );

      return plain(rows);
    },

    // метод сохранения события создания заказа в его истории
    async createdEvent(orderId, actorId) {
      await database.order_events.create({
        data: { order_id: orderId, actor_id: actorId, event_type: 'ORDER_CREATED' },
      });
    },

    // метод сохранения уведомления участнику о созданном заказе
    async notifyOrder(userId, projectId, orderId) {
      await database.notifications.create({
        data: {
          recipient_id: userId,
          event_type: 'ORDER_CREATED',
          project_id: projectId,
          order_id: orderId,
          message: 'Создан заказ по согласованному предложению',
        },
      });
    },

    // метод сохранения уведомления исполнителю о закрытии приглашения
    async notifyInvitation(row) {
      await database.notifications.create({
        data: {
          recipient_id: row.freelancer_id,
          event_type: 'INVITATION_STATUS_CHANGED',
          project_id: row.project_id,
          invitation_id: row.id,
          message: 'Приглашение закрыто',
          metadata: { status: 'EXPIRED', reason: row.closure_reason },
        },
      });
    },
  };
}
