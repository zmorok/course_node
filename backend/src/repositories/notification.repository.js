import { databaseNow, newest, page } from './database-tools.js';

export function createNotificationRepository(database) {
  return {
    // метод получения страницы уведомлений пользователя со счётчиком непрочитанных
    async list(recipientId, query) {
      const where = {
        recipient_id: recipientId,
        ...(query.read === 'unread'
          ? { read_at: null }
          : query.read === 'read'
            ? { read_at: { not: null } }
            : {}),
      };

      return {
        ...(await page(database, 'notifications', query, { where, orderBy: newest })),
        unread_count: await this.unread(recipientId),
      };
    },

    // метод подсчёта непрочитанных уведомлений пользователя
    unread: (recipientId) =>
      database.notifications.count({ where: { recipient_id: recipientId, read_at: null } }),

    // метод отметки собственного уведомления как прочитанного с сохранением первой даты
    async markRead(recipientId, id) {
      await database.notifications.updateMany({
        where: { id, recipient_id: recipientId, read_at: null },
        data: { read_at: await databaseNow(database) },
      });

      return database.notifications.findFirst({
        where: { id, recipient_id: recipientId },
        select: { id: true, read_at: true },
      });
    },

    // метод отметки всех непрочитанных уведомлений пользователя как прочитанных
    async markAllRead(recipientId) {
      return (
        await database.notifications.updateMany({
          where: { recipient_id: recipientId, read_at: null },
          data: { read_at: await databaseNow(database) },
        })
      ).count;
    },
  };
}
