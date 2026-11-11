import { AppError } from '../utils/app-error.js';
import { activeClient } from './source-dto.js';
import { requireFileActor } from './file.service.js';

const activeOrderStatuses = new Set(['IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED']);

// определение роли пользователя в заказе: заказчик, исполнитель или посторонний
export function orderMode(actor, order) {
  if (!actor?.id || !order) {
    return null;
  }

  if (actor.id === order.customer_id) {
    return 'customer';
  }

  if (actor.id === order.freelancer_id) {
    return 'freelancer';
  }

  return null;
}

// права определяются состоянием заказа и не зависят от выбранного режима списка или кнопок интерфейса
// перед изменением заказа повторно читаем данные под блокировками и проверяем разрешённое действие
// определение доступных действий по роли участника и текущему состоянию заказа
export function orderPermissions(actor, order) {
  const mode = orderMode(actor, order);
  const canRead = Boolean(mode && activeClient(actor));
  const canWork = canRead && ['IN_PROGRESS', 'REVISION_REQUESTED'].includes(order.status);

  const canReviewSubmission =
    canRead &&
    mode === 'customer' &&
    order.status === 'SUBMITTED' &&
    order.last_submission_status === 'SUBMITTED' &&
    Boolean(order.last_submission_id);

  const canDecideDeadline =
    canWork &&
    mode === 'customer' &&
    Boolean(order.pending_deadline_id) &&
    order.deadline_request_current === true;

  return {
    read: canRead,
    submit: canWork && mode === 'freelancer',
    requestDeadline: canWork && mode === 'freelancer' && !order.deadline_request_current,
    acceptSubmission: canReviewSubmission,
    requestRevision: canReviewSubmission,
    approveDeadline: canDecideDeadline,
    rejectDeadline: canDecideDeadline,
    cancel: canRead && activeOrderStatuses.has(order.status),
  };
}

// проверка доступа участника к конкретному действию с заказом
export function requireOrderAction(actor, order, action) {
  requireFileActor(actor);

  const permissions = orderPermissions(actor, order);

  if (!permissions.read) {
    throw new AppError(404, 'ORDER_NOT_FOUND', 'Заказ не найден');
  }

  if (!Object.hasOwn(permissions, action) || permissions[action] !== true) {
    throw new AppError(
      409,
      'ORDER_ACTION_NOT_ALLOWED',
      'Действие недоступно в текущем состоянии заказа',
    );
  }

  return permissions;
}
