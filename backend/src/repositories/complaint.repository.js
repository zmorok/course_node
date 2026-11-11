import { createSourceRepository } from './source.repository.js';
import {
  databaseNow,
  lockRows,
  page,
  newest,
  replaceLinks,
  fileInclude,
  userInclude,
  plain,
} from './database-tools.js';

const include = {
  order: true,
  target: userInclude,
  files: { ...fileInclude, orderBy: [{ created_at: 'asc' }, { file_id: 'asc' }] },
};

const flatten = ({ order, target, files, ...row }) => ({
  ...row,
  title_snapshot: order.title_snapshot,
  order_status: order.status,
  target_first_name: target.profile.first_name,
  target_last_name: target.profile.last_name,
  files: files.map((link) => plain(link.file)),
});

export function createComplaintRepository(database) {
  // получение жалобы с заказом, данными адресата и вложениями по заданным условиям
  async function own(where) {
    const row = await database.complaints.findFirst({ where, include });

    return row ? flatten(row) : undefined;
  }

  return {
    ...createSourceRepository(database),

    // метод получения заказа для определения участников при подаче жалобы
    context: (id) => database.orders.findUnique({ where: { id } }),

    // метод блокировки и повторного чтения заказа в текущей транзакции
    async lockOrder(id) {
      await lockRows(database, 'orders', [id]);

      return database.orders.findUnique({ where: { id } });
    },

    // метод получения жалобы текущего заявителя по конкретному заказу
    ownForOrder: (id, actorId) => own({ order_id: id, reporter_id: actorId }),

    // метод получения жалобы по идентификатору и её заявителю
    own: (id, actorId) => own({ id, reporter_id: actorId }),

    // метод получения жалоб заявителя по его режиму участия и статусу
    async list(actorId, query) {
      const result = await page(database, 'complaints', query, {
        where: {
          reporter_id: actorId,
          [query.mode === 'customer' ? 'customer_id' : 'freelancer_id']: actorId,
          status: query.status,
        },
        include,
        orderBy: newest,
      });

      return { ...result, items: result.items.map(flatten) };
    },

    // метод создания жалобы с сохранением участников заказа и определением второй стороны
    async create(order, actorId, input) {
      const now = await databaseNow(database);

      return (
        await database.complaints.create({
          data: {
            order_id: order.id,
            customer_id: order.customer_id,
            freelancer_id: order.freelancer_id,
            reporter_id: actorId,
            target_id: actorId === order.customer_id ? order.freelancer_id : order.customer_id,
            reason: input.reason,
            description: input.description,
            created_at: now,
            updated_at: now,
          },
        })
      ).id;
    },

    // метод блокировки и чтения жалобы, принадлежащей текущему заявителю
    async lockOwn(id, actorId) {
      await lockRows(database, 'complaints', [id]);

      return database.complaints.findFirst({ where: { id, reporter_id: actorId } });
    },

    // метод изменения причины и описания жалобы
    async update(id, input) {
      await database.complaints.updateMany({
        where: { id },
        data: { reason: input.reason, description: input.description },
      });
    },

    // метод удаления связей жалобы с её вложениями
    async detach(id) {
      await database.complaint_files.deleteMany({ where: { complaint_id: id } });
    },

    // метод удаления записи жалобы из базы
    async remove(id) {
      await database.complaints.deleteMany({ where: { id } });
    },

    // метод сохранения связей жалобы с выбранными файлами
    async attach(id, ids) {
      if (ids.length)
        await database.complaint_files.createMany({
          data: ids.map((fileId) => ({ complaint_id: id, file_id: fileId })),
        });
    },
  };
}
