import { createSourceRepository } from './source.repository.js';
import { sourceData, sourceInclude } from './source-projection.js';
import { databaseNow, lockRows, newest, page, plain, date } from './database-tools.js';

export function createProposalRepository(database) {
  return {
    ...createSourceRepository(database),

    // метод получения проекта и участников отклика для последующих проверок
    proposalContext: (id) =>
      database.proposals.findUnique({
        where: { id },
        select: { id: true, project_id: true, customer_id: true, freelancer_id: true },
      }),

    // метод блокировки отклика и определения актуальности предложенного срока
    async lockProposal(id) {
      await lockRows(database, 'proposals', [id]);

      const row = plain(await database.proposals.findUnique({ where: { id } }));

      return row
        ? { ...row, current: row.offered_deadline_at > (await databaseNow(database)) }
        : undefined;
    },

    // метод получения отклика с проектом и заказом для одного из его участников
    async find(id, actorId) {
      const row = await database.proposals.findFirst({
        where: { id, OR: [{ customer_id: actorId }, { freelancer_id: actorId }] },
        include: sourceInclude,
      });

      return row ? sourceData(row, await databaseNow(database)) : undefined;
    },

    // метод получения откликов по исполнителю, проекту и статусу
    async list(query, { freelancerId, projectId }) {
      const result = await page(database, 'proposals', query, {
        where: { freelancer_id: freelancerId, project_id: projectId, status: query.status },
        include: sourceInclude,
        orderBy: newest,
      });
      const now = await databaseNow(database);

      return { ...result, items: result.items.map((row) => sourceData(row, now)) };
    },

    // метод поиска ожидающего отклика исполнителя на конкретный проект
    pending: (projectId, freelancerId) =>
      database.proposals.findFirst({
        where: { project_id: projectId, freelancer_id: freelancerId, status: 'PENDING' },
        select: { id: true },
      }),

    // метод сохранения отклика с участниками проекта и предложенными условиями
    async create(project, freelancerId, input) {
      return (
        await database.proposals.create({
          data: {
            project_id: project.id,
            customer_id: project.customer_id,
            freelancer_id: freelancerId,
            message: input.message,
            offered_price: input.offeredPrice,
            offered_deadline_at: date(input.offeredDeadlineAt),
          },
        })
      ).id;
    },

    // метод сохранения статуса, причины закрытия и даты рассмотрения отклика
    async decide(id, status, reason) {
      await database.proposals.updateMany({
        where: { id },
        data: { status, closure_reason: reason ?? null, decided_at: await databaseNow(database) },
      });
    },

    // метод отклонения ожидающих откликов с истёкшим предложенным сроком
    async expire(projectId) {
      const now = await databaseNow(database);

      return plain(
        await database.proposals.updateManyAndReturn({
          where: { project_id: projectId, status: 'PENDING', offered_deadline_at: { lte: now } },
          data: { status: 'REJECTED', closure_reason: 'TERMS_EXPIRED', decided_at: now },
        }),
      );
    },

    // метод сохранения уведомления, связанного с откликом и проектом
    async notify(recipientId, type, projectId, proposalId, message, metadata = {}) {
      await database.notifications.create({
        data: {
          recipient_id: recipientId,
          event_type: type,
          project_id: projectId,
          proposal_id: proposalId,
          message,
          metadata,
        },
      });
    },
  };
}
