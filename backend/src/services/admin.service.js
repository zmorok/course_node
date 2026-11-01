import { createAdminAccountsService } from './admin-accounts.service.js';
import { AppError, ValidationError } from '../utils/app-error.js';
import { requireAdmin } from './admin-policy.js';
import { fileDto } from './file.service.js';

const missing = () => new AppError(404, 'COMPLAINT_NOT_FOUND', 'Жалоба не найдена');

const conflict = () =>
  new AppError(
    409,
    'COMPLAINT_STATE_CONFLICT',
    'Состояние или обработчик жалобы изменились. Обновите карточку',
  );

const invalid = (field, message) => new ValidationError([{ field, message }]);
const page = { page: 1, pageSize: 12 };

const toUserDto = (row) => ({
  id: row.id,
  email: row.email,
  username: row.username,
  role: row.role,
  status: row.status,
  deletedAt: row.deleted_at,
  lastOnlineAt: row.last_online_at,
  middleName: row.middle_name,
  gender: row.gender,
  city: row.city,
  country: row.country,
  description: row.description,
  firstName: row.first_name,
  lastName: row.last_name,
  headline: row.headline,
  phone: row.phone,
  createdAt: row.created_at,
  blockedBy: row.blocked_by,
  blockedAt: row.blocked_at,
  blockedUntil: row.blocked_until,
  blockReason: row.block_reason,
  lastUnblockedAt: row.last_unblocked_at,
  ...(row.customer_rating === undefined
    ? {}
    : {
        customerRating: row.customer_rating,
        freelancerRating: row.freelancer_rating,
        customerReviewCount: row.customer_review_count,
        freelancerReviewCount: row.freelancer_review_count,
      }),
});

const toComplaintSummary = (row) => ({
  id: row.id,
  status: row.status,
  reason: row.reason,
  createdAt: row.created_at,
  claimedAt: row.claimed_at,
  resolvedAt: row.resolved_at,
  assignedAdminId: row.assigned_admin_id,
  order: { id: row.order_id, title: row.title_snapshot, projectId: row.project_id },
  reporter: { id: row.reporter_id, username: row.reporter_username },
  target: { id: row.target_id, username: row.target_username },
});

function validateModerationAction(action) {
  if (action.type === 'PERMANENT_BLOCK' && action.expiresAt !== null) {
    throw invalid('body.expiresAt', 'Постоянная блокировка не имеет конечного срока');
  }

  if (action.type === 'TEMPORARY_BLOCK' && !action.expiresAt) {
    throw invalid('body.expiresAt', 'Укажите срок временной блокировки');
  }

  if (action.expiresAt && new Date(action.expiresAt).getTime() <= Date.now()) {
    throw invalid('body.expiresAt', 'Срок санкции должен быть в будущем');
  }
}

export function createAdminService({ repository, transaction }) {
  async function runComplaintOperation(actor, id, operation) {
    requireAdmin(actor);

    const context = await repository.complaint(id);

    if (!context) {
      throw missing();
    }

    return transaction(async (transactionRepository) => {
      const users = await transactionRepository.lockUsers([
        actor.id,
        context.customer_id,
        context.freelancer_id,
      ]);

      requireAdmin(users.find((user) => user.id === actor.id));

      const project = await transactionRepository.lockProject(context.project_id);
      const order = await transactionRepository.work.lockOrder(context.order_id);
      const complaint = await transactionRepository.complaint(id, true);

      if (
        !project ||
        !order ||
        !complaint ||
        complaint.order_id !== context.order_id ||
        complaint.customer_id !== context.customer_id ||
        complaint.freelancer_id !== context.freelancer_id
      ) {
        throw missing();
      }

      return operation(transactionRepository, complaint, users);
    });
  }

  async function applySanction(transactionRepository, adminId, target, action, complaintId = null) {
    if (!target || target.deleted_at || target.role !== 'CLIENT') {
      throw new AppError(404, 'USER_NOT_FOUND', 'Клиент не найден');
    }

    validateModerationAction(action);

    let id;

    if (action.type === 'WARNING') {
      id = (
        await transactionRepository.warnings.create(
          adminId,
          target.id,
          { message: action.reason, expiresAt: action.expiresAt },
          complaintId,
        )
      ).actionId;
    } else {
      id = await transactionRepository.action(
        adminId,
        target.id,
        action.type,
        action.reason,
        action.expiresAt,
        complaintId,
      );
      await transactionRepository.revokeSessions(target.id);

      const current =
        target.status === 'BLOCKED' &&
        (!target.blocked_until || new Date(target.blocked_until).getTime() > Date.now());

      const stronger =
        current &&
        (!target.blocked_until ||
          (action.expiresAt && new Date(target.blocked_until) >= new Date(action.expiresAt)));

      if (!stronger) {
        await transactionRepository.block(target, adminId, action.reason, action.expiresAt);
        target.status = 'BLOCKED';
        target.blocked_until = action.expiresAt;
      }
    }

    await transactionRepository.audit(
      adminId,
      'MODERATION_ACTION_CREATED',
      'moderation_action',
      id,
      { targetId: target.id, type: action.type, complaintId },
    );
    await transactionRepository.notify(
      target.id,
      'MODERATION_ACTION',
      action.type === 'WARNING'
        ? 'Вам выдано предупреждение администратора'
        : 'Администратор применил блокировку аккаунта',
      { complaintId, actionId: id },
    );

    return id;
  }

  return {
    ...createAdminAccountsService({ repository, transaction, dto: toUserDto }),
    async users(actor, query) {
      requireAdmin(actor);

      const data = await repository.users(query);

      return {
        ...data,
        items: data.items.map(toUserDto),
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async user(actor, id) {
      requireAdmin(actor);

      const row = await repository.user(id);

      if (!row) {
        throw new AppError(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      }

      const [sanctions, complaints] = await Promise.all([
        repository.sanctions(id, page),
        repository.queue(actor.id, { ...page, userId: id, assignment: 'all' }),
      ]);

      return {
        user: toUserDto(row),
        sanctions: { ...sanctions, ...page },
        complaints: { ...complaints, items: complaints.items.map(toComplaintSummary), ...page },
      };
    },

    async sanctions(actor, id, query) {
      requireAdmin(actor);

      if (!(await repository.user(id))) {
        throw new AppError(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      }

      return {
        ...(await repository.sanctions(id, query)),
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async block(actor, id, input) {
      requireAdmin(actor);

      return transaction(async (transactionRepository) => {
        const users = await transactionRepository.lockUsers([actor.id, id]);

        requireAdmin(users.find((user) => user.id === actor.id));
        await applySanction(
          transactionRepository,
          actor.id,
          users.find((user) => user.id === id),
          input,
        );

        return { user: toUserDto(await transactionRepository.user(id)) };
      });
    },

    async unblock(actor, id, input) {
      requireAdmin(actor);

      return transaction(async (transactionRepository) => {
        const users = await transactionRepository.lockUsers([actor.id, id]);

        requireAdmin(users.find((user) => user.id === actor.id));

        const target = users.find((user) => user.id === id);

        if (!target || target.deleted_at || target.role !== 'CLIENT') {
          throw new AppError(404, 'USER_NOT_FOUND', 'Клиент не найден');
        }

        if (target.status === 'BLOCKED') {
          await transactionRepository.unblock(id);
          await transactionRepository.audit(actor.id, 'USER_UNBLOCKED', 'user', id, {
            reason: input.reason,
          });

          const last = (await transactionRepository.sanctions(id, { page: 1, pageSize: 1 }))
            .items[0];

          if (last) {
            await transactionRepository.notify(
              id,
              'MODERATION_ACTION',
              'Администратор снял блокировку аккаунта',
              { actionId: last.id },
            );
          }
        }

        return { user: toUserDto(await transactionRepository.user(id)) };
      });
    },

    async queue(actor, query) {
      requireAdmin(actor);

      const data = await repository.queue(actor.id, query);

      return {
        ...data,
        items: data.items.map(toComplaintSummary),
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async detail(actor, id) {
      requireAdmin(actor);

      const context = await repository.complaint(id);

      if (!context) {
        throw missing();
      }

      const [complaint, order, project, customer, freelancer] = await Promise.all([
        repository.complaints.own(id, context.reporter_id),
        repository.orders.find(context.order_id, context.customer_id),
        repository.project(context.project_id),
        repository.user(context.customer_id),
        repository.user(context.freelancer_id),
      ]);

      const source = await repository.source(order);

      return {
        complaint: {
          id: complaint.id,
          reason: complaint.reason,
          description: complaint.description,
          status: complaint.status,
          reporterId: complaint.reporter_id,
          targetId: complaint.target_id,
          createdAt: complaint.created_at,
          assignedAdminId: complaint.assigned_admin_id,
          claimedAt: complaint.claimed_at,
          resolvedAt: complaint.resolved_at,
          resolutionNote: complaint.resolution_note,
          files: complaint.files.map(fileDto),
        },
        order: {
          id: order.id,
          title: order.title_snapshot,
          description: order.description_snapshot,
          status: order.status,
          price: order.agreed_price,
          initialDeadlineAt: order.initial_deadline_at,
          deadlineAt: order.deadline_at,
          completedAt: order.completed_at,
          cancelledAt: order.cancelled_at,
          cancelledBy: order.cancelled_by,
          cancellationReason: order.cancellation_reason,
          files: order.files,
          source: { type: order.proposal_id ? 'proposal' : 'invitation', ...source },
        },
        project,
        customer: toUserDto(customer),
        freelancer: toUserDto(freelancer),
        permissions: {
          claim: complaint.status === 'NEW',
          resolve: complaint.status === 'IN_REVIEW' && complaint.assigned_admin_id === actor.id,
        },
      };
    },

    async context(actor, id, section, query) {
      requireAdmin(actor);

      const complaint = await repository.complaint(id);

      if (!complaint) {
        throw missing();
      }

      const methods = {
        submissions: repository.work.listSubmissions,
        'deadline-requests': repository.work.listDeadlines,
        events: repository.work.listEvents,
        reviews: repository.reviews,
      };

      return {
        ...(await methods[section](complaint.order_id, query)),
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    claim: (actor, id) =>
      runComplaintOperation(actor, id, async (transactionRepository, complaint) => {
        if (complaint.status !== 'NEW') {
          throw conflict();
        }

        await transactionRepository.claim(id, actor.id);
        await transactionRepository.audit(actor.id, 'COMPLAINT_CLAIMED', 'complaint', id, {
          orderId: complaint.order_id,
        });
        await transactionRepository.notify(
          complaint.reporter_id,
          'COMPLAINT_IN_REVIEW',
          'Ваша жалоба взята на рассмотрение',
          { complaintId: id },
        );

        return { complaintId: id, status: 'IN_REVIEW' };
      }),

    reject: (actor, id, input) =>
      runComplaintOperation(actor, id, async (transactionRepository, complaint) => {
        if (complaint.status !== 'IN_REVIEW' || complaint.assigned_admin_id !== actor.id) {
          throw conflict();
        }

        const actionId = await transactionRepository.action(
          actor.id,
          null,
          'REJECT',
          input.resolutionNote,
          null,
          id,
        );

        await transactionRepository.finish(id, 'REJECTED', input.resolutionNote);
        await transactionRepository.audit(actor.id, 'COMPLAINT_REJECTED', 'complaint', id, {
          actionId,
        });
        await transactionRepository.notify(
          complaint.reporter_id,
          'COMPLAINT_RESOLVED',
          'Ваша жалоба отклонена с обоснованием',
          { complaintId: id },
        );

        return { complaintId: id, status: 'REJECTED' };
      }),

    resolve: (actor, id, input) =>
      runComplaintOperation(actor, id, async (transactionRepository, complaint, users) => {
        if (complaint.status !== 'IN_REVIEW' || complaint.assigned_admin_id !== actor.id) {
          throw conflict();
        }

        for (const action of input.actions) {
          if (![complaint.reporter_id, complaint.target_id].includes(action.targetId)) {
            throw invalid('body.actions', 'Санкция допустима только стороне исходного заказа');
          }

          validateModerationAction(action);
        }

        const actionIds = [];

        for (const action of input.actions) {
          actionIds.push(
            await applySanction(
              transactionRepository,
              actor.id,
              users.find((user) => user.id === action.targetId),
              action,
              id,
            ),
          );
        }
        await transactionRepository.finish(id, 'RESOLVED', input.resolutionNote);
        await transactionRepository.audit(actor.id, 'COMPLAINT_RESOLVED', 'complaint', id, {
          actionIds,
        });
        await transactionRepository.notify(
          complaint.reporter_id,
          'COMPLAINT_RESOLVED',
          'Ваша жалоба рассмотрена. Решение сохранено',
          { complaintId: id },
        );

        return { complaintId: id, status: 'RESOLVED' };
      }),
  };
}
