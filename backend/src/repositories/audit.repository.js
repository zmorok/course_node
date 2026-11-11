import { Prisma } from '@prisma/client';
import { auditEntry } from '../utils/audit-entry.js';
import { databaseNow, lockRows, page, newest, oldest, date } from './database-tools.js';

export function createAuditRepository(database) {
  return {
    // метод блокировки строки аккаунта перед повторной проверкой прав администратора
    async lockAdmin(id) {
      await lockRows(database, 'users', [id]);

      return database.users.findUnique({ where: { id } });
    },

    // метод сохранения импортированных событий с пропуском дубликатов по хешу
    async importEntries(actorId, entries) {
      return (
        await database.audit_imported_entries.createMany({
          skipDuplicates: true,
          data: entries.map((entry) => ({
            digest: entry.digest,
            imported_by: actorId,
            original_data: entry.data,
          })),
        })
      ).count;
    },

    // метод получения страницы импортированных событий аудита
    imported: (query) =>
      page(database, 'audit_imported_entries', query, {
        orderBy: [{ imported_at: 'desc' }, { id: 'desc' }],
      }),

    // метод сохранения события аудита с контекстом запроса и очищенными снимками данных
    async audit(...args) {
      const entry = auditEntry(...args);

      await database.audit_logs.create({
        data: {
          actor_id: entry.actorId,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          metadata: JSON.parse(entry.metadata),
          old_data: entry.oldData ? JSON.parse(entry.oldData) : Prisma.DbNull,
          new_data: entry.newData ? JSON.parse(entry.newData) : Prisma.DbNull,
          ip_address: entry.ip,
          created_at: await databaseNow(database),
        },
      });
    },

    // метод поиска событий аудита с данными автора, фильтрами и пагинацией
    async list(query) {
      const where = {};

      for (const [key, column] of Object.entries({
        actorId: 'actor_id',
        action: 'action',
        entityType: 'entity_type',
        entityId: 'entity_id',
      }))
        if (query[key]) where[column] = query[key];

      if (query.createdFrom || query.createdTo)
        where.created_at = {
          gte: query.createdFrom ? date(query.createdFrom) : undefined,
          lte: query.createdTo ? date(query.createdTo) : undefined,
        };

      const options = {
        where,
        include: { actor: { include: { profile: true } } },
        orderBy: query.sort === 'oldest' ? oldest : newest,
      };

      const flatten = ({ actor, ...row }) => ({
        ...row,
        username: actor?.username ?? null,
        first_name: actor?.profile?.first_name ?? null,
        last_name: actor?.profile?.last_name ?? null,
      });

      if (query.search) {
        const rows = (await database.audit_logs.findMany(options))
          .map(flatten)
          .filter((row) =>
            [
              row.username,
              row.first_name,
              row.last_name,
              row.action,
              row.entity_type,
              row.entity_id,
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(query.search.toLowerCase()),
          );

        return {
          total: rows.length,
          items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
        };
      }

      const result = await page(database, 'audit_logs', query, options);

      return { ...result, items: result.items.map(flatten) };
    },
  };
}
