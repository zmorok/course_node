import { createAuditRepository } from './audit.repository.js';
import { lockRows, plain } from './database-tools.js';

export function createSourceRepository(database) {
  return {
    // метод получения идентификатора проекта и его заказчика
    projectContext: (id) =>
      database.projects.findUnique({ where: { id }, select: { id: true, customer_id: true } }),

    // метод блокировки аккаунтов участников в порядке UUID и чтения их текущих данных
    async lockUsers(ids) {
      const locked = await lockRows(database, 'users', ids);

      return database.users.findMany({ where: { id: { in: locked } }, orderBy: { id: 'asc' } });
    },

    // метод блокировки и повторного чтения проекта в текущей транзакции
    async lockProject(id) {
      await lockRows(database, 'projects', [id]);

      return plain(await database.projects.findUnique({ where: { id } }));
    },

    audit: createAuditRepository(database).audit,
  };
}
