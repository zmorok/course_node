import {
  databaseNow,
  plain,
  page,
  newest,
  activeStatuses,
  userInclude,
  fileInclude,
  fileData,
} from './database-tools.js';

export const orderInclude = {
  project: true,
  customer: userInclude,
  freelancer: userInclude,
  files: fileInclude,
  submissions: { orderBy: { version: 'desc' }, take: 1 },
  deadlines: { where: { status: 'PENDING' }, take: 1 },
};

export function orderData(
  { project, customer, freelancer, files, submissions, deadlines, ...row },
  now,
) {
  const submission = submissions[0],
    deadline = deadlines[0];
  const future = Boolean(deadline && deadline.proposed_deadline_at > now),
    matches = Boolean(deadline && +deadline.previous_deadline_at === +row.deadline_at);

  return {
    ...plain(row),
    closed_at: row.completed_at ?? row.cancelled_at,
    project_status: project.status,
    customer_username: customer.username,
    customer_first_name: customer.profile.first_name,
    customer_last_name: customer.profile.last_name,
    freelancer_username: freelancer.username,
    freelancer_first_name: freelancer.profile.first_name,
    freelancer_last_name: freelancer.profile.last_name,
    is_overdue: row.deadline_at < now && activeStatuses.includes(row.status),
    files: files.map((link) => fileData(link)),
    last_submission_id: submission?.id ?? null,
    last_submission_version: submission?.version ?? null,
    last_submission_status: submission?.status ?? null,
    last_submission_created_at: submission?.created_at ?? null,
    pending_deadline_id: deadline?.id ?? null,
    previous_deadline_at: deadline?.previous_deadline_at ?? null,
    proposed_deadline_at: deadline?.proposed_deadline_at ?? null,
    deadline_request_created_at: deadline?.created_at ?? null,
    server_now: now,
    deadline_request_future: future,
    deadline_request_matches: matches,
    deadline_request_current:
      ['IN_PROGRESS', 'REVISION_REQUESTED'].includes(row.status) && future && matches,
  };
}

export function createOrderRepository(database) {
  return {
    // метод получения активных или исторических заказов пользователя в выбранном режиме участия
    async list(actorId, query) {
      const where = {
        [query.mode === 'customer' ? 'customer_id' : 'freelancer_id']: actorId,
        status: query.status ?? {
          in: query.scope === 'history' ? ['COMPLETED', 'CANCELLED'] : activeStatuses,
        },
      };
      const now = await databaseNow(database);

      if (query.scope === 'history') {
        const rows = await database.orders.findMany({ where, include: orderInclude });

        rows.sort(
          (a, b) =>
            +(b.completed_at ?? b.cancelled_at) - +(a.completed_at ?? a.cancelled_at) ||
            b.id.localeCompare(a.id),
        );

        return {
          total: rows.length,
          items: rows
            .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
            .map((row) => orderData(row, now)),
        };
      }

      const result = await page(database, 'orders', query, {
        where,
        include: orderInclude,
        orderBy: newest,
      });

      return { ...result, items: result.items.map((row) => orderData(row, now)) };
    },

    // метод получения заказа для его участника с вложениями, последним результатом и запросом срока
    async find(id, actorId) {
      const row = await database.orders.findFirst({
        where: { id, OR: [{ customer_id: actorId }, { freelancer_id: actorId }] },
        include: orderInclude,
      });

      return row ? orderData(row, await databaseNow(database)) : undefined;
    },
  };
}
