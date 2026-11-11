import { createSourceRepository } from './source.repository.js';
import { sourceData, sourceInclude } from './source-projection.js';
import {
  databaseNow,
  lockRows,
  newest,
  page,
  plain,
  date,
  blockingStatuses,
} from './database-tools.js';

export function createInvitationRepository(database) {
  return {
    ...createSourceRepository(database),

    // метод проверки публичной доступности профиля приглашаемого исполнителя
    candidate: (id) =>
      database.v_public_profiles.findUnique({ where: { user_id: id }, select: { user_id: true } }),

    // метод получения открытых проектов заказчика без блокирующего заказа и актуального приглашения
    async availableProjects(customerId, freelancerId) {
      const now = await databaseNow(database);

      return plain(
        await database.projects.findMany({
          where: {
            customer_id: customerId,
            status: 'OPEN',
            orders: { none: { status: { in: blockingStatuses } } },
            project_invitations: {
              none: {
                freelancer_id: freelancerId,
                status: 'PENDING',
                offered_deadline_at: { gt: now },
                OR: [{ expires_at: null }, { expires_at: { gt: now } }],
              },
            },
          },
          select: { id: true, title: true, budget: true, desired_deadline_at: true },
          orderBy: newest,
          take: 100,
        }),
      );
    },

    // метод получения проекта и участников приглашения для последующих проверок
    context: (id) =>
      database.project_invitations.findUnique({
        where: { id },
        select: { id: true, project_id: true, customer_id: true, freelancer_id: true },
      }),

    // метод блокировки приглашения и определения актуальности его сроков
    async lockInvitation(id) {
      await lockRows(database, 'project_invitations', [id]);

      const row = plain(await database.project_invitations.findUnique({ where: { id } }));
      const now = await databaseNow(database);

      return row
        ? {
            ...row,
            current: row.offered_deadline_at > now && (!row.expires_at || row.expires_at > now),
          }
        : undefined;
    },

    // метод получения приглашения с проектом и заказом для одного из его участников
    async find(id, actorId) {
      const row = await database.project_invitations.findFirst({
        where: { id, OR: [{ customer_id: actorId }, { freelancer_id: actorId }] },
        include: sourceInclude,
      });

      return row ? sourceData(row, await databaseNow(database)) : undefined;
    },

    // метод получения приглашений по участникам, проекту и статусу
    async list(query, { customerId, freelancerId, projectId }) {
      const result = await page(database, 'project_invitations', query, {
        where: {
          customer_id: customerId,
          freelancer_id: freelancerId,
          project_id: projectId,
          status: query.status,
        },
        include: sourceInclude,
        orderBy: newest,
      });
      const now = await databaseNow(database);

      return { ...result, items: result.items.map((row) => sourceData(row, now)) };
    },

    // метод поиска ожидающего приглашения конкретному исполнителю на проект
    pending: (projectId, freelancerId) =>
      database.project_invitations.findFirst({
        where: { project_id: projectId, freelancer_id: freelancerId, status: 'PENDING' },
        select: { id: true },
      }),

    // метод сохранения приглашения с предложенными условиями и сроком действия
    async create(project, input) {
      return (
        await database.project_invitations.create({
          data: {
            project_id: project.id,
            customer_id: project.customer_id,
            freelancer_id: input.freelancerId,
            message: input.message,
            offered_price: input.offeredPrice,
            offered_deadline_at: date(input.offeredDeadlineAt),
            expires_at: date(input.expiresAt),
          },
        })
      ).id;
    },

    // метод сохранения статуса, причины закрытия и даты рассмотрения приглашения
    async decide(id, status, reason) {
      await database.project_invitations.updateMany({
        where: { id },
        data: { status, closure_reason: reason ?? null, decided_at: await databaseNow(database) },
      });
    },

    // метод закрытия просроченных приглашений с разделением причин истечения срока
    async expire(projectId) {
      const now = await databaseNow(database);
      const rows = [];

      for (const [where, reason] of [
        [{ offered_deadline_at: { lte: now } }, 'TERMS_EXPIRED'],
        [{ expires_at: { lte: now } }, 'TIME_EXPIRED'],
      ])
        rows.push(
          ...(await database.project_invitations.updateManyAndReturn({
            where: { project_id: projectId, status: 'PENDING', ...where },
            data: { status: 'EXPIRED', closure_reason: reason, decided_at: now },
          })),
        );

      return plain(rows);
    },

    // метод сохранения уведомления, связанного с приглашением и проектом
    async notify(recipientId, type, row, message, metadata = {}) {
      await database.notifications.create({
        data: {
          recipient_id: recipientId,
          event_type: type,
          project_id: row.project_id,
          invitation_id: row.id,
          message,
          metadata,
        },
      });
    },
  };
}
