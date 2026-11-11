import { AppError, ValidationError } from '../utils/app-error.js';
import { requireFileActor } from './file.service.js';
import { orderMode, requireOrderAction } from './order-policy.js';

const missing = () => new AppError(404, 'ORDER_NOT_FOUND', 'Заказ не найден');
const conflict = () =>
  new AppError(409, 'ORDER_STATE_CONFLICT', 'Состояние заказа изменилось. Обновите карточку');
const expired = () =>
  new AppError(409, 'DEADLINE_REQUEST_EXPIRED', 'Запрос изменения срока больше не актуален');

const deadlineInputError = () =>
  new ValidationError([
    { field: 'body.proposedDeadlineAt', message: 'Укажите будущий срок, отличный от текущего' },
  ]);

// запись события заказа в историю и аудит с уведомлением второй стороны
async function recordOrderEvent(
  transactionRepository,
  order,
  actorId,
  type,
  { submission = null, request = null, reason = null } = {},
) {
  const metadata = {
    ...(submission ? { submissionId: submission.id, version: submission.version } : {}),
    ...(request
      ? {
          requestId: request.id,
          previousDeadlineAt: request.previous_deadline_at,
          proposedDeadlineAt: request.proposed_deadline_at,
        }
      : {}),
    ...(reason ? { reason } : {}),
  };

  await transactionRepository.event(
    order.id,
    actorId,
    type,
    submission?.id ?? null,
    request?.id ?? null,
    metadata,
  );
  await transactionRepository.audit(actorId, type, 'order', order.id, {
    projectId: order.project_id,
    ...metadata,
  });

  const messages = {
    SUBMISSION_CREATED: 'Исполнитель сдал новую версию результата',
    REVISION_REQUESTED: 'Заказчик запросил доработку результата',
    ORDER_COMPLETED: 'Заказчик принял результат. Заказ завершён',
    ORDER_CANCELLED: 'Заказ отменён с указанием причины. Проект снова открыт',
    DEADLINE_REQUESTED: 'Исполнитель предложил изменить срок',
    DEADLINE_APPROVED: 'Заказчик одобрил новый срок',
    DEADLINE_REJECTED: 'Заказчик отклонил изменение срока',
    DEADLINE_EXPIRED: 'Запрос изменения срока закрыт',
  };

  const target =
    type === 'ORDER_CANCELLED'
      ? actorId === order.customer_id
        ? order.freelancer_id
        : order.customer_id
      : ['SUBMISSION_CREATED', 'DEADLINE_REQUESTED'].includes(type)
        ? order.customer_id
        : order.freelancer_id;

  await transactionRepository.notify(
    target,
    type.startsWith('DEADLINE_') && type !== 'DEADLINE_REQUESTED' ? 'DEADLINE_DECIDED' : type,
    order,
    messages[type],
    { status: type, ...metadata },
  );
}

export function createOrderWorkService({
  repository,
  orders: orderRepository,
  transaction,
  fileService,
}) {
  // получение заказа с проверкой права участника на чтение
  async function getReadableOrder(actor, id) {
    requireFileActor(actor);

    const row = await orderRepository.find(id, actor.id);

    if (!row) {
      throw missing();
    }

    requireOrderAction(actor, row, 'read');

    return row;
  }

  // выполнение операции в транзакции с блокировками и повторной проверкой участников
  async function runOrderOperation(actor, id, operation) {
    requireFileActor(actor);

    const context = await repository.context(id);

    if (!orderMode(actor, context)) {
      throw missing();
    }

    try {
      const result = await transaction(
        async (transactionRepository, transactionOrderRepository, fileRepository) => {
          const users = await transactionRepository.lockUsers([
            context.customer_id,
            context.freelancer_id,
          ]);

          const current = users.find((user) => user.id === actor.id);

          requireFileActor(current);

          const project = await transactionRepository.lockProject(context.project_id);

          if (!project || !(await transactionRepository.lockOrder(id))) {
            throw missing();
          }

          const row = await transactionOrderRepository.find(id, actor.id);

          if (
            !row ||
            row.project_id !== context.project_id ||
            row.customer_id !== context.customer_id ||
            row.freelancer_id !== context.freelancer_id
          ) {
            throw missing();
          }

          requireOrderAction(current, row, 'read');

          return operation(
            transactionRepository,
            transactionOrderRepository,
            fileRepository,
            current,
            row,
            project,
          );
        },
      );

      if (result?.error) {
        throw result.error;
      }

      return result;
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(
          409,
          'ORDER_WORK_CONFLICT',
          'Версия результата или ожидающий запрос уже существует',
        );
      }

      throw error;
    }
  }

  // закрытие ожидающего запроса срока с записью причины и события
  async function closePendingDeadline(transactionRepository, order, reason) {
    if (!order.pending_deadline_id) {
      return;
    }

    const request = await transactionRepository.decideDeadline(
      order.pending_deadline_id,
      null,
      'EXPIRED',
      reason,
    );

    await recordOrderEvent(transactionRepository, order, null, 'DEADLINE_EXPIRED', {
      request,
      reason,
    });
  }

  // определение причины, по которой запрос изменения срока стал неактуален
  function getDeadlineExpirationReason(order) {
    // состояние заказа имеет приоритет перед актуальностью предложенного срока
    if (order.status === 'SUBMITTED') {
      return 'ORDER_SUBMITTED';
    }

    if (order.status === 'COMPLETED') {
      return 'ORDER_COMPLETED';
    }

    if (order.status === 'CANCELLED') {
      return 'ORDER_CANCELLED';
    }

    if (!order.deadline_request_future) {
      return 'TIME_EXPIRED';
    }

    if (!order.deadline_request_matches) {
      return 'DEADLINE_CHANGED';
    }

    return null;
  }

  // проверка состояния проекта перед изменением хода выполнения заказа
  function requireActiveProject(project) {
    if (project.status !== 'IN_PROGRESS') {
      throw conflict();
    }
  }

  // рассмотрение последней версии результата с принятием или запросом доработки
  async function reviewSubmission(actor, id, submissionId, input, accept) {
    return runOrderOperation(
      actor,
      id,
      async (
        transactionRepository,
        transactionOrderRepository,
        fileRepository,
        current,
        order,
        project,
      ) => {
        const submission = await transactionRepository.submission(id, submissionId);

        if (!submission) {
          throw new AppError(404, 'SUBMISSION_NOT_FOUND', 'Версия результата не найдена');
        }

        requireOrderAction(current, order, accept ? 'acceptSubmission' : 'requestRevision');
        requireActiveProject(project);

        if (submission.id !== order.last_submission_id || submission.status !== 'SUBMITTED') {
          throw new AppError(
            409,
            'SUBMISSION_NOT_CURRENT',
            'Рассмотреть можно только последнюю нерассмотренную версию',
          );
        }

        if (accept) {
          await closePendingDeadline(transactionRepository, order, 'ORDER_COMPLETED');
          await transactionRepository.reviewSubmission(
            submissionId,
            current.id,
            'ACCEPTED',
            input.comment,
          );
          await transactionRepository.completeOrder(order);
        } else {
          await closePendingDeadline(transactionRepository, order, 'ORDER_SUBMITTED');
          await transactionRepository.reviewSubmission(
            submissionId,
            current.id,
            'REVISION_REQUESTED',
            input.comment,
          );
          await transactionRepository.requestRevision(id);
        }

        await recordOrderEvent(
          transactionRepository,
          order,
          current.id,
          accept ? 'ORDER_COMPLETED' : 'REVISION_REQUESTED',
          { submission },
        );

        return { submissionId };
      },
    );
  }

  return {
    // метод получения списка сданных версий результата заказа
    async submissions(actor, id, query) {
      await getReadableOrder(actor, id);

      return {
        ...(await repository.listSubmissions(id, query)),
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    // метод получения истории запросов изменения срока заказа
    async deadlines(actor, id, query) {
      await getReadableOrder(actor, id);

      return {
        ...(await repository.listDeadlines(id, query)),
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    // метод получения истории событий заказа с данными участников
    async events(actor, id, query) {
      const order = await getReadableOrder(actor, id);
      const result = await repository.listEvents(id, query);

      return {
        ...result,
        page: query.page,
        pageSize: query.pageSize,
        items: result.items.map((row) => ({
          id: row.id,
          type: row.event_type,
          createdAt: row.created_at,
          submissionId: row.submission_id,
          requestId: row.deadline_request_id,
          actor: row.actor_id
            ? {
                id: row.actor_id,
                firstName: row.first_name,
                lastName: row.last_name,
                participantMode: orderMode({ id: row.actor_id }, order),
              }
            : null,
          metadata: Object.fromEntries(
            ['version', 'reason', 'previousDeadlineAt', 'proposedDeadlineAt']
              .filter((key) => Object.hasOwn(row.metadata, key))
              .map((key) => [key, row.metadata[key]]),
          ),
        })),
      };
    },

    // метод отмены активного заказа с указанием причины и повторным открытием проекта
    async cancel(actor, id, input) {
      return runOrderOperation(
        actor,
        id,
        async (
          transactionRepository,
          transactionOrderRepository,
          fileRepository,
          current,
          order,
          project,
        ) => {
          requireOrderAction(current, order, 'cancel');
          requireActiveProject(project);
          await closePendingDeadline(transactionRepository, order, 'ORDER_CANCELLED');
          await transactionRepository.cancelOrder(order, current.id, input.reason);
          await recordOrderEvent(transactionRepository, order, current.id, 'ORDER_CANCELLED', {
            reason: input.reason,
          });

          return { orderId: id };
        },
      );
    },

    // метод сдачи новой версии результата с вложениями и передачей заказа на проверку
    async submit(actor, id, input) {
      return runOrderOperation(
        actor,
        id,
        async (
          transactionRepository,
          transactionOrderRepository,
          fileRepository,
          current,
          order,
          project,
        ) => {
          requireOrderAction(current, order, 'submit');
          requireActiveProject(project);
          await fileService.attachable(fileRepository, current.id, input.fileIds, []);

          const submission = await transactionRepository.createSubmission(order, input);

          await transactionRepository.attachFiles(submission.id, input.fileIds);
          await closePendingDeadline(transactionRepository, order, 'ORDER_SUBMITTED');
          await transactionRepository.submitOrder(id);
          await recordOrderEvent(transactionRepository, order, current.id, 'SUBMISSION_CREATED', {
            submission,
          });

          return { submissionId: submission.id, version: submission.version };
        },
      );
    },

    // метод запроса доработки последней сданной версии результата
    revision: (actor, id, submissionId, input) =>
      reviewSubmission(actor, id, submissionId, input, false),

    // метод принятия последней сданной версии с завершением заказа и проекта
    accept: (actor, id, submissionId, input) =>
      reviewSubmission(actor, id, submissionId, input, true),

    // метод предложения нового срока исполнителем с закрытием неактуального запроса
    async requestDeadline(actor, id, input) {
      return runOrderOperation(
        actor,
        id,
        async (
          transactionRepository,
          transactionOrderRepository,
          fileRepository,
          current,
          order,
          project,
        ) => {
          requireOrderAction(current, order, 'requestDeadline');
          requireActiveProject(project);
          // сначала проверяем новый срок, чтобы ошибочный запрос не закрыл прежнее предложение
          if (
            Date.parse(input.proposedDeadlineAt) <= new Date(order.server_now).getTime() ||
            Date.parse(input.proposedDeadlineAt) === new Date(order.deadline_at).getTime()
          ) {
            throw deadlineInputError();
          }

          if (order.pending_deadline_id) {
            await closePendingDeadline(
              transactionRepository,
              order,
              getDeadlineExpirationReason(order),
            );
          }

          const request = await transactionRepository.createDeadline(order, input);

          if (!request) {
            throw deadlineInputError();
          }

          await recordOrderEvent(transactionRepository, order, current.id, 'DEADLINE_REQUESTED', {
            request,
          });

          return { requestId: request.id };
        },
      );
    },

    // метод одобрения или отклонения нового срока заказчиком с проверкой актуальности
    async decideDeadline(actor, id, requestId, input, approve) {
      return runOrderOperation(
        actor,
        id,
        async (
          transactionRepository,
          transactionOrderRepository,
          fileRepository,
          current,
          order,
          project,
        ) => {
          if (orderMode(current, order) !== 'customer') {
            throw new AppError(
              409,
              'ORDER_ACTION_NOT_ALLOWED',
              'Запрос срока рассматривает заказчик',
            );
          }

          const request = await transactionRepository.deadlineRequest(id, requestId);

          if (!request) {
            throw new AppError(
              404,
              'DEADLINE_REQUEST_NOT_FOUND',
              'Запрос изменения срока не найден',
            );
          }

          if (request.status !== 'PENDING') {
            throw new AppError(
              409,
              'DEADLINE_REQUEST_DECIDED',
              'Запрос срока уже рассмотрен или закрыт',
            );
          }

          const reason = getDeadlineExpirationReason(order);

          if (reason) {
            await closePendingDeadline(transactionRepository, order, reason);

            return { error: expired() };
          }

          requireOrderAction(current, order, approve ? 'approveDeadline' : 'rejectDeadline');
          requireActiveProject(project);

          if (approve && !(await transactionRepository.changeDeadline(id, requestId))) {
            await closePendingDeadline(transactionRepository, order, 'TIME_EXPIRED');

            return { error: expired() };
          }

          await transactionRepository.decideDeadline(
            requestId,
            current.id,
            approve ? 'APPROVED' : 'REJECTED',
            input.reason,
          );
          await recordOrderEvent(
            transactionRepository,
            order,
            current.id,
            approve ? 'DEADLINE_APPROVED' : 'DEADLINE_REJECTED',
            { request, reason: input.reason },
          );

          return { requestId };
        },
      );
    },
  };
}
