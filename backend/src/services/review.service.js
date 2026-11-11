import { AppError } from '../utils/app-error.js';
import { requireFileActor } from './file.service.js';
import { orderMode } from './order-policy.js';

const missingOrder = () => new AppError(404, 'ORDER_NOT_FOUND', 'Заказ не найден');
const missingReview = () => new AppError(404, 'REVIEW_NOT_FOUND', 'Отзыв не найден');
const terminal = (order) => ['COMPLETED', 'CANCELLED'].includes(order.status);

function toReviewDto(row, isPublic = false) {
  return {
    id: row.id,
    rating: row.rating,
    text: row.text,
    files: row.files ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: { id: row.author_id, firstName: row.author_first_name, lastName: row.author_last_name },
    recipient: {
      id: row.recipient_id,
      firstName: row.recipient_first_name,
      lastName: row.recipient_last_name,
    },
    recipientMode: row.recipient_id === row.customer_id ? 'customer' : 'freelancer',
    order: {
      id: row.order_id,
      status: row.order_status,
      ...(isPublic ? {} : { title: row.title_snapshot }),
    },
    ...(isPublic ? {} : { deletedAt: row.deleted_at }),
  };
}

export function createReviewService({ repository, transaction }) {
  // замена изображений отзыва с проверкой владельца и очисткой старых вложений
  async function replaceReviewAttachments(transactionRepository, actor, id, ids = []) {
    const before = (await transactionRepository.find(id)).files ?? [];
    const retained = before.map((file) => file.id);
    const rows = await transactionRepository.files.lockFiles(ids);

    if (rows.length !== ids.length || rows.some((file) => file.uploaded_by !== actor.id)) {
      throw new AppError(404, 'FILE_NOT_FOUND', 'Файл не найден');
    }

    for (const file of rows) {
      if (!file.mime_type.startsWith('image/')) {
        throw new AppError(422, 'REVIEW_IMAGE_REQUIRED', 'Для отзыва выберите изображение');
      }

      if (!retained.includes(file.id) && (await transactionRepository.files.used(file.id))) {
        throw new AppError(409, 'FILE_IN_USE', 'Файл уже используется');
      }
    }
    await transactionRepository.replaceFiles(id, ids);
    await transactionRepository.files.markUnusedDeleted(
      retained.filter((fileId) => !ids.includes(fileId)),
    );
  }

  // выполнение операции с отзывом в транзакции после проверки участников и статуса заказа
  async function runReviewOperation(actor, context, operation) {
    requireFileActor(actor);

    if (!orderMode(actor, context)) {
      throw missingOrder();
    }

    try {
      return await transaction(async (transactionRepository) => {
        const users = await transactionRepository.lockUsers([
          context.customer_id,
          context.freelancer_id,
        ]);

        requireFileActor(users.find((user) => user.id === actor.id));

        const project = await transactionRepository.lockProject(context.project_id);
        const order = await transactionRepository.lockOrder(context.order_id ?? context.id);

        if (
          !project ||
          !order ||
          !orderMode(actor, order) ||
          order.project_id !== context.project_id ||
          order.customer_id !== context.customer_id ||
          order.freelancer_id !== context.freelancer_id
        ) {
          throw missingOrder();
        }

        if (!terminal(order)) {
          throw new AppError(
            409,
            'REVIEW_ORDER_NOT_TERMINAL',
            'Отзыв доступен после завершения или отмены заказа',
          );
        }

        return operation(transactionRepository, order);
      });
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(
          409,
          'REVIEW_ALREADY_EXISTS',
          'Ваш отзыв по этому заказу уже существует. Измените или восстановите его',
        );
      }

      throw error;
    }
  }

  // изменение, скрытие или восстановление собственного отзыва с записью аудита
  async function changeReview(actor, id, kind, input) {
    requireFileActor(actor);

    const context = await repository.context(id);

    if (!context || context.author_id !== actor.id) {
      throw missingReview();
    }

    return runReviewOperation(actor, context, async (transactionRepository, order) => {
      const row = await transactionRepository.lockOwn(order.id, actor.id);

      if (!row || row.id !== id) {
        throw missingReview();
      }

      if (kind === 'update') {
        await replaceReviewAttachments(transactionRepository, actor, id, input.fileIds);
        await transactionRepository.update(id, input);
        await transactionRepository.audit(actor.id, 'REVIEW_UPDATED', 'review', id, {
          orderId: order.id,
          rating: input.rating,
        });
      }

      if (kind === 'hide' && !row.deleted_at) {
        await transactionRepository.hide(id);
        await transactionRepository.audit(actor.id, 'REVIEW_HIDDEN', 'review', id, {
          orderId: order.id,
        });
      }

      if (kind === 'restore' && row.deleted_at) {
        await transactionRepository.restore(id);
        await transactionRepository.audit(actor.id, 'REVIEW_RESTORED', 'review', id, {
          orderId: order.id,
        });
      }

      return toReviewDto(await transactionRepository.find(id));
    });
  }

  return {
    // метод создания отзыва о второй стороне завершённого или отменённого заказа
    async create(actor, orderId, input) {
      requireFileActor(actor);

      const context = await repository.orderContext(orderId);

      if (!context || !orderMode(actor, context)) {
        throw missingOrder();
      }

      return runReviewOperation(actor, context, async (transactionRepository, order) => {
        if (await transactionRepository.lockOwn(order.id, actor.id)) {
          throw new AppError(
            409,
            'REVIEW_ALREADY_EXISTS',
            'Ваш отзыв по этому заказу уже существует. Измените или восстановите его',
          );
        }

        const recipientId =
          actor.id === order.customer_id ? order.freelancer_id : order.customer_id;
        const id = await transactionRepository.create(order, actor.id, recipientId, input);

        await replaceReviewAttachments(transactionRepository, actor, id, input.fileIds);
        await transactionRepository.audit(actor.id, 'REVIEW_CREATED', 'review', id, {
          orderId,
          recipientId,
          rating: input.rating,
        });

        return toReviewDto(await transactionRepository.find(id));
      });
    },

    // метод получения отзывов по заказу и возможности оставить свой отзыв
    async order(actor, orderId) {
      requireFileActor(actor);

      const order = await repository.orderContext(orderId);

      if (!order || !orderMode(actor, order)) {
        throw missingOrder();
      }

      const rows = await repository.forOrder(orderId);
      const own = rows.find((row) => row.author_id === actor.id);

      return {
        items: terminal(order)
          ? rows.filter((row) => !row.deleted_at).map((row) => toReviewDto(row))
          : [],
        ownReview: own ? toReviewDto(own) : null,
        canReview: terminal(order) && !own,
        participantMode: orderMode(actor, order),
        recipientId: actor.id === order.customer_id ? order.freelancer_id : order.customer_id,
      };
    },

    // метод получения своих отправленных или полученных отзывов по фильтрам
    async own(actor, query) {
      requireFileActor(actor);

      const result = await repository.list(query, { actorId: actor.id });
      const { available, ...data } = result;

      return {
        ...data,
        items: data.items.map((row) => toReviewDto(row)),
        mode: query.mode,
        direction: query.direction,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    // метод получения публичных отзывов о пользователе
    async public(userId, query) {
      const result = await repository.list(query, { userId });

      if (!result.available) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Профиль не найден');
      }

      const { available, ...data } = result;

      return {
        ...data,
        items: data.items.map((row) => toReviewDto(row, true)),
        mode: query.mode,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    // метод изменения оценки, текста и изображений собственного отзыва
    update: (actor, id, input) => changeReview(actor, id, 'update', input),

    // метод скрытия собственного отзыва из публичного просмотра
    hide: (actor, id) => changeReview(actor, id, 'hide'),

    // метод восстановления ранее скрытого собственного отзыва
    restore: (actor, id) => changeReview(actor, id, 'restore'),
  };
}
