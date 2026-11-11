import { createAdminAccountsRepository } from './admin-accounts.repository.js';
import { createSourceRepository } from './source.repository.js';
import { createOrderRepository } from './order.repository.js';
import { createOrderWorkRepository } from './order-work.repository.js';
import { createComplaintRepository } from './complaint.repository.js';
import { createWarningRepository } from './warning.repository.js';
import {
  databaseNow,
  lockRows,
  plain,
  page,
  newest,
  oldest,
  date,
  contains,
  userInclude,
  fileInclude,
} from './database-tools.js';

const textCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const userData = ({ profile, ...row }, now) => ({
  ...row,
  ...profile,
  id: row.id,
  status:
    row.status === 'BLOCKED' && (!row.blocked_until || row.blocked_until > now)
      ? 'BLOCKED'
      : 'ACTIVE',
});

export function createAdminRepository(database) {
  return {
    ...createSourceRepository(database),
    ...createAdminAccountsRepository(database),
    orders: createOrderRepository(database),
    work: createOrderWorkRepository(database),
    complaints: createComplaintRepository(database),
    warnings: createWarningRepository(database),

    // метод поиска неудалённых пользователей с фильтрами и пагинацией
    async users(query) {
      const now = await databaseNow(database),
        where = { deleted_at: null, role: query.role };

      if (query.status === 'BLOCKED')
        Object.assign(where, {
          status: 'BLOCKED',
          OR: [{ blocked_until: null }, { blocked_until: { gt: now } }],
        });

      if (query.status === 'ACTIVE')
        where.OR = [{ status: 'ACTIVE' }, { blocked_until: { lte: now } }];

      const options = { where, include: { profile: true }, orderBy: newest };

      if (query.search || query.sort === 'name') {
        let rows = (await database.users.findMany(options)).map((row) => userData(row, now));

        if (query.search)
          rows = rows.filter((row) =>
            [row.username, row.email, row.first_name, row.last_name]
              .join(' ')
              .toLowerCase()
              .includes(query.search.toLowerCase()),
          );

        if (query.sort === 'name')
          rows.sort(
            (a, b) =>
              textCompare(a.last_name.toLowerCase(), b.last_name.toLowerCase()) ||
              textCompare(a.first_name.toLowerCase(), b.first_name.toLowerCase()) ||
              textCompare(a.id, b.id),
          );

        return {
          total: rows.length,
          items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
        };
      }

      const result = await page(database, 'users', query, options);

      return { ...result, items: result.items.map((row) => userData(row, now)) };
    },

    // метод получения аккаунта с профилем, рейтингами и актуальным состоянием блокировки
    async user(id) {
      const row = await database.users.findUnique({ where: { id }, include: { profile: true } });

      if (!row?.profile) return undefined;

      const rating = plain(await database.v_user_ratings.findUnique({ where: { user_id: id } }));

      return {
        ...userData(row, await databaseNow(database)),
        customer_rating: rating?.customer_rating ?? null,
        freelancer_rating: rating?.freelancer_rating ?? null,
        customer_review_count: rating?.customer_review_count ?? null,
        freelancer_review_count: rating?.freelancer_review_count ?? null,
      };
    },

    // метод получения истории санкций пользователя с признаком их актуальности
    async sanctions(id, query) {
      const result = await page(database, 'moderation_actions', query, {
        where: { target_id: id },
        include: { admin: userInclude, target: true },
        orderBy: newest,
      });
      const now = await databaseNow(database);

      return {
        ...result,
        items: result.items.map(({ admin, target, ...row }) => ({
          ...row,
          first_name: admin.profile.first_name,
          last_name: admin.profile.last_name,
          current:
            (row.action_type === 'WARNING' ||
              !target.last_unblocked_at ||
              row.created_at > target.last_unblocked_at) &&
            (!row.expires_at || row.expires_at > now),
        })),
      };
    },

    // метод получения очереди жалоб с фильтрами по заказу, участникам и назначению
    async queue(actorId, query) {
      const where = {};

      for (const [key, col] of Object.entries({
        id: 'id',
        status: 'status',
        orderId: 'order_id',
        assignedAdminId: 'assigned_admin_id',
      }))
        if (query[key]) where[col] = query[key];

      if (query.projectId || query.categoryId)
        where.order = { project: { id: query.projectId, category_id: query.categoryId } };

      if (query.reporter) where.reporter = { username: contains(query.reporter) };

      if (query.target) where.target = { username: contains(query.target) };

      if (query.reason) where.reason = contains(query.reason);

      if (query.userId) where.OR = [{ reporter_id: query.userId }, { target_id: query.userId }];

      if (query.assignment === 'mine') where.AND = [{ assigned_admin_id: actorId }];

      if (query.assignment === 'unassigned') where.AND = [{ assigned_admin_id: null }];

      if (query.createdFrom || query.createdTo)
        where.created_at = {
          gte: query.createdFrom ? date(query.createdFrom) : undefined,
          lte: query.createdTo ? date(query.createdTo) : undefined,
        };

      const result = await page(database, 'complaints', query, {
        where,
        include: {
          order: { select: { project_id: true, title_snapshot: true } },
          reporter: { select: { username: true } },
          target: { select: { username: true } },
        },
        orderBy: oldest,
      });

      return {
        ...result,
        items: result.items.map(({ order, reporter, target, ...row }) => ({
          ...row,
          title_snapshot: order.title_snapshot,
          project_id: order.project_id,
          reporter_username: reporter.username,
          target_username: target.username,
        })),
      };
    },

    // метод получения жалобы со связанным проектом и необязательной блокировкой строки
    async complaint(id, lock = false) {
      if (lock) await lockRows(database, 'complaints', [id]);

      const row = await database.complaints.findUnique({
        where: { id },
        include: { order: { select: { project_id: true } } },
      });

      if (!row) return undefined;

      const { order, ...rest } = row;

      return { ...rest, project_id: order.project_id };
    },

    // метод получения проекта с категорией и доступными вложениями для рассмотрения жалобы
    async project(id) {
      const row = await database.projects.findUnique({
        where: { id },
        include: { category: true, files: { ...fileInclude, orderBy: { file_id: 'asc' } } },
      });

      return row
        ? {
            id: row.id,
            title: row.title,
            description: row.description,
            status: row.status,
            category_id: row.category_id,
            budget: plain(row.budget),
            desired_deadline_at: row.desired_deadline_at,
            category_name: row.category?.name ?? null,
            files: row.files.map((link) => ({
              id: link.file.id,
              originalName: link.file.original_name,
              sizeBytes: Number(link.file.size_bytes),
            })),
          }
        : undefined;
    },

    // метод получения исходного отклика или приглашения, по которому создан заказ
    async source(order) {
      const row = await database[
        order.proposal_id ? 'proposals' : 'project_invitations'
      ].findUnique({ where: { id: order.proposal_id ?? order.invitation_id } });

      return row
        ? {
            id: row.id,
            message: row.message,
            price: plain(row.offered_price),
            offered_deadline_at: row.offered_deadline_at,
            status: row.status,
            created_at: row.created_at,
            decided_at: row.decided_at,
          }
        : undefined;
    },

    // метод получения отзывов по заказу для административного просмотра
    reviews: (id, query) =>
      page(database, 'reviews', query, {
        where: { order_id: id },
        select: {
          id: true,
          author_id: true,
          recipient_id: true,
          rating: true,
          text: true,
          deleted_at: true,
          created_at: true,
        },
        orderBy: oldest,
      }),

    // метод назначения администратора на жалобу и перевода её на рассмотрение
    async claim(id, actorId) {
      await database.complaints.updateMany({
        where: { id },
        data: {
          status: 'IN_REVIEW',
          assigned_admin_id: actorId,
          claimed_at: await databaseNow(database),
        },
      });
    },

    // метод сохранения итогового статуса жалобы, обоснования и даты решения
    async finish(id, status, note) {
      await database.complaints.updateMany({
        where: { id },
        data: { status, resolution_note: note, resolved_at: await databaseNow(database) },
      });
    },

    // метод создания записи административного решения или санкции
    async action(actorId, targetId, type, reason, expiresAt, complaintId = null) {
      return (
        await database.moderation_actions.create({
          data: {
            admin_id: actorId,
            target_id: targetId,
            action_type: type,
            reason,
            expires_at: date(expiresAt),
            complaint_id: complaintId,
            created_at: await databaseNow(database),
          },
        })
      ).id;
    },

    // метод сохранения блокировки аккаунта с автором, причиной и сроком
    async block(target, actorId, reason, expiresAt) {
      await database.users.updateMany({
        where: { id: target.id },
        data: {
          status: 'BLOCKED',
          blocked_by: actorId,
          blocked_at: await databaseNow(database),
          blocked_until: date(expiresAt),
          block_reason: reason,
        },
      });
    },

    // метод отзыва всех ещё действующих сессий пользователя
    async revokeSessions(id) {
      await database.auth_sessions.updateMany({
        where: { user_id: id, revoked_at: null },
        data: { revoked_at: await databaseNow(database) },
      });
    },

    // метод снятия блокировки и сохранения даты последней разблокировки
    async unblock(id) {
      await database.users.updateMany({
        where: { id },
        data: {
          status: 'ACTIVE',
          blocked_by: null,
          blocked_at: null,
          blocked_until: null,
          block_reason: null,
          last_unblocked_at: await databaseNow(database),
        },
      });
    },

    // метод сохранения уведомления о решении по жалобе или применённой санкции
    async notify(recipientId, type, message, { complaintId = null, actionId = null } = {}) {
      await database.notifications.create({
        data: {
          recipient_id: recipientId,
          event_type: type,
          message,
          complaint_id: complaintId,
          moderation_action_id: actionId,
        },
      });
    },
  };
}
