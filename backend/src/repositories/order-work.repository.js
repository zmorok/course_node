import { createSourceRepository } from './source.repository.js';
import {
  databaseNow,
  lockRows,
  page,
  newest,
  fileInclude,
  fileData,
  date,
  userInclude,
} from './database-tools.js';

export function createOrderWorkRepository(database) {
  return {
    ...createSourceRepository(database),

    // метод получения проекта и участников заказа для последующих проверок
    context: (id) =>
      database.orders.findUnique({
        where: { id },
        select: { id: true, project_id: true, customer_id: true, freelancer_id: true },
      }),

    // метод блокировки и повторного чтения заказа в текущей транзакции
    async lockOrder(id) {
      await lockRows(database, 'orders', [id]);

      return database.orders.findUnique({ where: { id } });
    },

    // метод блокировки и получения версии результата, принадлежащей указанному заказу
    async submission(orderId, id) {
      await lockRows(database, 'order_submissions', [id]);

      return database.order_submissions.findFirst({ where: { id, order_id: orderId } });
    },

    // метод блокировки и получения запроса срока, принадлежащего указанному заказу
    async deadlineRequest(orderId, id) {
      await lockRows(database, 'order_deadline_requests', [id]);

      return database.order_deadline_requests.findFirst({ where: { id, order_id: orderId } });
    },

    // метод сохранения результата с очередным номером версии в пределах заказа
    async createSubmission(order, input) {
      const last = await database.order_submissions.aggregate({
        where: { order_id: order.id },
        _max: { version: true },
      });

      return database.order_submissions.create({
        data: {
          order_id: order.id,
          freelancer_id: order.freelancer_id,
          version: (last._max.version ?? 0) + 1,
          comment: input.comment,
          links: input.links,
        },
      });
    },

    // метод сохранения связей версии результата с выбранными файлами
    async attachFiles(id, ids) {
      if (ids.length)
        await database.submission_files.createMany({
          data: ids.map((fileId) => ({ submission_id: id, file_id: fileId })),
        });
    },

    // метод перевода заказа в состояние проверки сданного результата
    async submitOrder(id) {
      await database.orders.updateMany({ where: { id }, data: { status: 'SUBMITTED' } });
    },

    // метод сохранения решения по версии результата, проверяющего и комментария
    async reviewSubmission(id, actorId, status, comment) {
      await database.order_submissions.updateMany({
        where: { id },
        data: {
          status,
          reviewed_by: actorId,
          reviewed_at: await databaseNow(database),
          review_comment: comment,
        },
      });
    },

    // метод перевода заказа в состояние доработки
    async requestRevision(id) {
      await database.orders.updateMany({ where: { id }, data: { status: 'REVISION_REQUESTED' } });
    },

    // метод сохранения завершения заказа и связанного проекта
    async completeOrder(order) {
      const now = await databaseNow(database);

      await database.orders.updateMany({
        where: { id: order.id },
        data: { status: 'COMPLETED', completed_at: now },
      });
      await database.projects.updateMany({
        where: { id: order.project_id },
        data: { status: 'COMPLETED', completed_at: now },
      });
    },

    // метод отмены заказа и ожидающего проверки результата с повторным открытием проекта
    async cancelOrder(order, actorId, reason) {
      await database.order_submissions.updateMany({
        where: { order_id: order.id, status: 'SUBMITTED' },
        data: { status: 'CANCELLED' },
      });
      await database.orders.updateMany({
        where: { id: order.id },
        data: {
          status: 'CANCELLED',
          cancelled_by: actorId,
          cancelled_at: await databaseNow(database),
          cancellation_reason: reason,
        },
      });
      await database.projects.updateMany({
        where: { id: order.project_id },
        data: { status: 'OPEN' },
      });
    },

    // метод сохранения запроса будущего срока, отличающегося от текущего
    async createDeadline(order, input) {
      const proposed = date(input.proposedDeadlineAt);

      if (proposed <= (await databaseNow(database)) || +proposed === +new Date(order.deadline_at))
        return undefined;

      return database.order_deadline_requests.create({
        data: {
          order_id: order.id,
          freelancer_id: order.freelancer_id,
          previous_deadline_at: date(order.deadline_at),
          proposed_deadline_at: proposed,
          reason: input.reason,
        },
      });
    },

    // метод сохранения решения по запросу срока с автором, датой и обоснованием
    async decideDeadline(id, actorId, status, reason) {
      return database.order_deadline_requests.update({
        where: { id },
        data: {
          status,
          decided_by: actorId,
          decided_at: await databaseNow(database),
          decision_reason: reason ?? null,
        },
      });
    },

    // метод изменения срока заказа, если исходный срок совпадает и новый ещё не истёк
    async changeDeadline(orderId, requestId) {
      const request = await database.order_deadline_requests.findFirst({
        where: { id: requestId, order_id: orderId },
      });

      if (!request || request.proposed_deadline_at <= (await databaseNow(database))) return false;

      return (
        (
          await database.orders.updateMany({
            where: { id: orderId, deadline_at: request.previous_deadline_at },
            data: { deadline_at: request.proposed_deadline_at },
          })
        ).count === 1
      );
    },

    // метод сохранения события заказа со ссылками на версию результата или запрос срока
    async event(orderId, actorId, type, submissionId, requestId, metadata) {
      await database.order_events.create({
        data: {
          order_id: orderId,
          actor_id: actorId,
          event_type: type,
          submission_id: submissionId,
          deadline_request_id: requestId,
          metadata,
          created_at: await databaseNow(database),
        },
      });
    },

    // метод получения страницы истории заказа с именами авторов событий
    async listEvents(orderId, query) {
      const result = await page(database, 'order_events', query, {
        where: { order_id: orderId },
        include: { actor: userInclude },
        orderBy: newest,
      });

      return {
        ...result,
        items: result.items.map(({ actor, ...row }) => ({
          ...row,
          first_name: actor?.profile?.first_name ?? null,
          last_name: actor?.profile?.last_name ?? null,
        })),
      };
    },

    // метод сохранения уведомления участнику о событии заказа
    async notify(recipientId, type, order, message, metadata) {
      await database.notifications.create({
        data: {
          recipient_id: recipientId,
          event_type: type,
          project_id: order.project_id,
          order_id: order.id,
          message,
          metadata,
        },
      });
    },

    // метод получения версий результата с вложениями и данными рассмотрения
    async listSubmissions(orderId, query) {
      const result = await page(database, 'order_submissions', query, {
        where: { order_id: orderId },
        include: { files: fileInclude },
        orderBy: { version: 'desc' },
      });

      return {
        ...result,
        items: result.items.map((row) => ({
          id: row.id,
          version: row.version,
          comment: row.comment,
          links: row.links,
          status: row.status,
          reviewedBy: row.reviewed_by,
          reviewedAt: row.reviewed_at,
          reviewComment: row.review_comment,
          createdAt: row.created_at,
          files: row.files.map((link) => fileData(link)),
        })),
      };
    },

    // метод получения запросов изменения срока с признаком их текущей актуальности
    async listDeadlines(orderId, query) {
      const result = await page(database, 'order_deadline_requests', query, {
        where: { order_id: orderId },
        include: { order: { select: { status: true, deadline_at: true } } },
        orderBy: newest,
      });
      const now = await databaseNow(database);

      return {
        ...result,
        items: result.items.map((row) => ({
          id: row.id,
          previousDeadlineAt: row.previous_deadline_at,
          proposedDeadlineAt: row.proposed_deadline_at,
          reason: row.reason,
          status: row.status,
          decidedBy: row.decided_by,
          decidedAt: row.decided_at,
          decisionReason: row.decision_reason,
          createdAt: row.created_at,
          isCurrent:
            row.status === 'PENDING' &&
            ['IN_PROGRESS', 'REVISION_REQUESTED'].includes(row.order.status) &&
            +row.previous_deadline_at === +row.order.deadline_at &&
            row.proposed_deadline_at > now,
        })),
      };
    },
  };
}
