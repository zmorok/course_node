import { AppError } from '../utils/app-error.js';
import { fileDto, requireFileActor } from './file.service.js';
import { orderMode } from './order-policy.js';

const missingOrder = () => new AppError(404, 'ORDER_NOT_FOUND', 'Заказ не найден');
const terminal = (order) => ['COMPLETED', 'CANCELLED'].includes(order.status);
const duplicate = () =>
  new AppError(409, 'COMPLAINT_ALREADY_EXISTS', 'Ваша жалоба по этому заказу уже подана');

const toComplaintDto = (row) => ({
  id: row.id,
  order: { id: row.order_id, title: row.title_snapshot, status: row.order_status },
  target: { id: row.target_id, firstName: row.target_first_name, lastName: row.target_last_name },
  participantMode: row.reporter_id === row.customer_id ? 'customer' : 'freelancer',
  reason: row.reason,
  description: row.description,
  status: row.status,
  canEdit: row.status === 'NEW',
  createdAt: row.created_at,
  claimedAt: row.claimed_at,
  resolvedAt: row.resolved_at,
  resolutionNote: row.resolution_note,
  files: row.files.map(fileDto),
});

export function createComplaintService({ repository, transaction, fileService }) {
  // изменение или удаление собственной жалобы до начала её рассмотрения
  async function changeOwnComplaint(actor, id, input) {
    requireFileActor(actor);

    const context = await repository.own(id, actor.id);

    if (!context) {
      throw new AppError(404, 'COMPLAINT_NOT_FOUND', 'Жалоба не найдена');
    }

    const result = await transaction(async (transactionRepository, fileRepository) => {
      const users = await transactionRepository.lockUsers([
        context.customer_id,
        context.freelancer_id,
      ]);

      requireFileActor(users.find((user) => user.id === actor.id));

      const row = await transactionRepository.lockOwn(id, actor.id);

      if (!row) {
        throw new AppError(404, 'COMPLAINT_NOT_FOUND', 'Жалоба не найдена');
      }

      if (row.status !== 'NEW') {
        throw new AppError(
          409,
          'COMPLAINT_ALREADY_IN_REVIEW',
          'Изменить или удалить можно только новую жалобу до начала рассмотрения',
        );
      }

      const previous = await transactionRepository.own(id, actor.id);
      const retained = previous.files.map((file) => file.id);

      if (input) {
        await fileService.attachable(fileRepository, actor.id, input.fileIds, retained);
      }

      await transactionRepository.detach(id);

      if (input) {
        await transactionRepository.update(id, input);
        await transactionRepository.attach(id, input.fileIds);
      } else {
        await transactionRepository.remove(id);
      }

      await fileRepository.markUnusedDeleted(
        retained.filter((fileId) => !input?.fileIds.includes(fileId)),
      );
      await transactionRepository.audit(
        actor.id,
        input ? 'COMPLAINT_UPDATED' : 'COMPLAINT_REMOVED',
        'complaint',
        id,
        { orderId: row.order_id },
        {
          oldData: { reason: row.reason, description: row.description, fileIds: retained },
          newData: input ?? null,
        },
      );

      return input
        ? { complaint: toComplaintDto(await transactionRepository.own(id, actor.id)) }
        : { removed: true };
    });

    await fileService.drainDeletes();

    return result;
  }

  return {
    // метод изменения текста и вложений собственной новой жалобы
    update: (actor, id, input) => changeOwnComplaint(actor, id, input),

    // метод удаления собственной новой жалобы
    remove: (actor, id) => changeOwnComplaint(actor, id),

    // метод получения своей жалобы по заказу и возможности подать новую
    async order(actor, id) {
      requireFileActor(actor);

      const order = await repository.context(id);

      if (!order || !orderMode(actor, order)) {
        throw missingOrder();
      }

      const own = await repository.ownForOrder(id, actor.id);

      return {
        complaint: own ? toComplaintDto(own) : null,
        canComplain: terminal(order) && !own,
        recipientId: actor.id === order.customer_id ? order.freelancer_id : order.customer_id,
      };
    },

    // метод подачи жалобы на вторую сторону завершённого или отменённого заказа
    async create(actor, id, input) {
      requireFileActor(actor);

      const context = await repository.context(id);

      if (!context || !orderMode(actor, context)) {
        throw missingOrder();
      }

      try {
        return await transaction(async (transactionRepository, fileRepository) => {
          const users = await transactionRepository.lockUsers([
            context.customer_id,
            context.freelancer_id,
          ]);

          requireFileActor(users.find((user) => user.id === actor.id));

          const project = await transactionRepository.lockProject(context.project_id);
          const order = await transactionRepository.lockOrder(id);

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
              'COMPLAINT_ORDER_NOT_TERMINAL',
              'Жалоба доступна после завершения или отмены заказа',
            );
          }

          if (await transactionRepository.ownForOrder(id, actor.id)) {
            throw duplicate();
          }

          await fileService.attachable(fileRepository, actor.id, input.fileIds);

          const complaintId = await transactionRepository.create(order, actor.id, input);

          await transactionRepository.attach(complaintId, input.fileIds);
          await transactionRepository.audit(
            actor.id,
            'COMPLAINT_CREATED',
            'complaint',
            complaintId,
            {
              orderId: id,
              targetId: actor.id === order.customer_id ? order.freelancer_id : order.customer_id,
            },
          );

          return toComplaintDto(await transactionRepository.own(complaintId, actor.id));
        });
      } catch (error) {
        if (error.code === '23505') {
          throw duplicate();
        }

        throw error;
      }
    },

    // метод получения списка собственных жалоб по фильтрам
    async list(actor, query) {
      requireFileActor(actor);

      const data = await repository.list(actor.id, query);

      return {
        ...data,
        items: data.items.map(toComplaintDto),
        mode: query.mode,
        status: query.status ?? null,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    // метод получения подробных данных собственной жалобы
    async own(actor, id) {
      requireFileActor(actor);

      const row = await repository.own(id, actor.id);

      if (!row) {
        throw new AppError(404, 'COMPLAINT_NOT_FOUND', 'Жалоба не найдена');
      }

      return toComplaintDto(row);
    },
  };
}
