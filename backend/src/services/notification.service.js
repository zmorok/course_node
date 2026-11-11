import { AppError } from '../utils/app-error.js';

// проверка входа в аккаунт и отсутствия действующей блокировки
function requireActiveUser(actor) {
  if (!actor) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт');
  }

  if (
    actor.status === 'BLOCKED' &&
    (!actor.blocked_until || new Date(actor.blocked_until) > new Date())
  ) {
    throw new AppError(403, 'ACCOUNT_BLOCKED', 'Аккаунт заблокирован');
  }
}

// если связано несколько сущностей, выбираем первую по указанному ниже приоритету
// выбор ссылки для уведомления по приоритету связанных сущностей
function getNotificationHref(row) {
  if (row.moderation_action_id) {
    return '/me/warnings';
  }

  if (row.complaint_id) {
    return `/me/complaints/${row.complaint_id}`;
  }

  if (row.order_id) {
    return `/orders/${row.order_id}`;
  }

  if (row.invitation_id) {
    return '/me/invitations';
  }

  if (row.proposal_id) {
    return row.event_type === 'PROPOSAL_CREATED' ? `/projects/${row.project_id}` : '/me/proposals';
  }

  if (row.project_id) {
    return `/projects/${row.project_id}`;
  }

  return null;
}

function toNotificationDto(row) {
  const href = getNotificationHref(row);

  const outcome =
    row.event_type === 'DEADLINE_DECIDED' &&
    ['DEADLINE_APPROVED', 'DEADLINE_REJECTED', 'DEADLINE_EXPIRED'].includes(row.metadata?.status)
      ? row.metadata.status
      : undefined;

  return {
    id: row.id,
    type: row.event_type,
    ...(outcome ? { outcome } : {}),
    message: row.message,
    createdAt: new Date(row.created_at).toISOString(),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    href,
  };
}

export function createNotificationService({ repository }) {
  return {
    // метод получения своих уведомлений с количеством непрочитанных
    async list(actor, query) {
      requireActiveUser(actor);

      const result = await repository.list(actor.id, query);

      return {
        items: result.items.map(toNotificationDto),
        total: result.total,
        unreadCount: result.unread_count,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    // метод получения количества непрочитанных уведомлений
    async unread(actor) {
      requireActiveUser(actor);

      return { unreadCount: await repository.unread(actor.id) };
    },

    // метод отметки одного собственного уведомления как прочитанного
    async markRead(actor, id) {
      requireActiveUser(actor);

      const row = await repository.markRead(actor.id, id);

      if (!row) {
        throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Уведомление не найдено');
      }

      return { id: row.id, readAt: row.read_at };
    },

    // метод отметки всех собственных уведомлений как прочитанных
    async markAllRead(actor) {
      requireActiveUser(actor);

      return { updated: await repository.markAllRead(actor.id) };
    },
  };
}
