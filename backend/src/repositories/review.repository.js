import { Prisma } from '@prisma/client';
import { createFileRepository } from './file.repository.js';
import { createSourceRepository } from './source.repository.js';
import {
  databaseNow,
  lockRows,
  plain,
  page,
  newest,
  oldest,
  replaceLinks,
  fileInclude,
  fileData,
  userInclude,
} from './database-tools.js';

const include = {
  order: true,
  author: userInclude,
  recipient: userInclude,
  files: { ...fileInclude, orderBy: { file_id: 'asc' } },
};

const flatten = ({ order, author, recipient, files, ...row }) => ({
  ...plain(row),
  title_snapshot: order.title_snapshot,
  order_status: order.status,
  customer_id: order.customer_id,
  freelancer_id: order.freelancer_id,
  author_first_name: author.profile.first_name,
  author_last_name: author.profile.last_name,
  recipient_first_name: recipient.profile.first_name,
  recipient_last_name: recipient.profile.last_name,
  files: files.map((link) => {
    const { createdAt, ...file } = fileData(link);

    return file;
  }),
});

export function createReviewRepository(database) {
  return {
    ...createSourceRepository(database),
    files: createFileRepository(database),

    // метод получения личных или публичных отзывов с количеством видимых записей и средней оценкой
    async list(query, { actorId, userId } = {}) {
      const isPublic = Boolean(userId),
        written = !isPublic && query.direction === 'written',
        mode = query.mode === 'customer' ? 'customer_id' : 'freelancer_id';
      const available =
        !isPublic ||
        Boolean(
          await database.v_public_profiles.findUnique({
            where: { user_id: userId },
            select: { user_id: true },
          }),
        );
      const where = {
        ...(isPublic
          ? { recipient_id: userId, [mode]: userId }
          : { [mode]: actorId, [written ? 'author_id' : 'recipient_id']: actorId }),
        order: { status: { in: ['COMPLETED', 'CANCELLED'] } },
        ...(!written ? { deleted_at: null } : {}),
        ...(!available ? { id: { in: [] } } : {}),
      };
      const result = await page(database, 'reviews', query, { where, include, orderBy: newest });
      const visible = await database.reviews.aggregate({
        where: { ...where, deleted_at: null },
        _sum: { rating: true },
        _count: { id: true },
      });
      const count = visible._count.id;

      return {
        ...result,
        items: result.items.map(flatten),
        available,
        rating: count ? new Prisma.Decimal(visible._sum.rating).div(count).toFixed(2) : null,
        visibleCount: count,
      };
    },

    // метод полной замены связей отзыва с изображениями
    replaceFiles: (id, ids) =>
      replaceLinks(database, 'review_files', 'review_id', id, 'file_id', ids),

    // метод получения заказа для определения участников и доступности отзывов
    orderContext: (id) => database.orders.findUnique({ where: { id } }),

    // метод блокировки и повторного чтения заказа перед изменением отзывов
    async lockOrder(id) {
      await lockRows(database, 'orders', [id]);

      return database.orders.findUnique({ where: { id } });
    },

    // метод получения автора отзыва, заказа, проекта и участников сделки
    async context(id) {
      const row = await database.reviews.findUnique({ where: { id }, include: { order: true } });

      return row
        ? {
            id: row.id,
            author_id: row.author_id,
            order_id: row.order_id,
            project_id: row.order.project_id,
            customer_id: row.order.customer_id,
            freelancer_id: row.order.freelancer_id,
          }
        : undefined;
    },

    // метод поиска и блокировки отзыва текущего автора по заказу
    async lockOwn(orderId, actorId) {
      const row = await database.reviews.findFirst({
        where: { order_id: orderId, author_id: actorId },
      });

      if (!row) return undefined;

      await lockRows(database, 'reviews', [row.id]);

      return database.reviews.findUnique({ where: { id: row.id } });
    },

    // метод получения отзыва с участниками, заказом и изображениями
    async find(id) {
      const row = await database.reviews.findUnique({ where: { id }, include });

      return row ? flatten(row) : undefined;
    },

    // метод получения всех отзывов по заказу, включая скрытые записи
    async forOrder(orderId) {
      return (
        await database.reviews.findMany({ where: { order_id: orderId }, include, orderBy: oldest })
      ).map(flatten);
    },

    // метод сохранения отзыва с автором, адресатом и участниками исходного заказа
    async create(order, actorId, recipientId, input) {
      const now = await databaseNow(database);

      return (
        await database.reviews.create({
          data: {
            order_id: order.id,
            customer_id: order.customer_id,
            freelancer_id: order.freelancer_id,
            author_id: actorId,
            recipient_id: recipientId,
            rating: input.rating,
            text: input.text,
            created_at: now,
            updated_at: now,
          },
        })
      ).id;
    },

    // метод изменения оценки и текста отзыва
    async update(id, input) {
      await database.reviews.updateMany({
        where: { id },
        data: { rating: input.rating, text: input.text },
      });
    },

    // метод пометки отзыва как скрытого с сохранением записи в базе
    async hide(id) {
      await database.reviews.updateMany({
        where: { id },
        data: { deleted_at: await databaseNow(database) },
      });
    },

    // метод снятия отметки о скрытии отзыва
    async restore(id) {
      await database.reviews.updateMany({ where: { id }, data: { deleted_at: null } });
    },
  };
}
