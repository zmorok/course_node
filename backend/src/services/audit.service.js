import { parseAuditArchive } from './audit-transfer.js';
import { AppError } from '../utils/app-error.js';
import { requireAdmin } from './admin-policy.js';
import { auditData } from '../utils/audit-data.js';

export function createAuditService({ repository, transaction }) {
  return {
    // метод выгрузки событий аудита в архив с ограничением количества и размера
    async export(actor, query) {
      requireAdmin(actor);

      const data = await this.list(actor, { ...query, page: 1, pageSize: 5000 });

      if (data.total > 5000) {
        throw new AppError(
          422,
          'AUDIT_EXPORT_LIMIT',
          'Сузьте период или фильтр: максимум 5000 событий в файле',
        );
      }

      const result = {
        format: 'workify-audit',
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: data.items,
      };

      if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) {
        throw new AppError(
          422,
          'AUDIT_EXPORT_LIMIT',
          'Сузьте фильтр: максимальный размер архива — 2 МБ',
        );
      }

      return result;
    },

    // метод загрузки событий из архива с пропуском дубликатов и записью результата в аудит
    async import(actor, buffer) {
      requireAdmin(actor);

      const entries = parseAuditArchive(buffer);

      return transaction(async (transactionRepository) => {
        requireAdmin(await transactionRepository.lockAdmin(actor.id));

        const count = await transactionRepository.importEntries(actor.id, entries);

        await transactionRepository.audit(actor.id, 'AUDIT_IMPORTED', 'audit_archive', null, {
          received: entries.length,
          imported: count,
        });

        return { received: entries.length, imported: count, duplicates: entries.length - count };
      });
    },

    // метод получения списка импортированных событий аудита
    async imported(actor, query) {
      requireAdmin(actor);

      const result = await repository.imported(query);

      return { ...result, page: query.page, pageSize: query.pageSize };
    },

    // метод получения журнала аудита с фильтрами и подготовкой данных для ответа
    async list(actor, query) {
      requireAdmin(actor);

      const data = await repository.list(query);

      return {
        ...data,
        items: data.items.map((row) => ({
          id: row.id,
          actor: row.actor_id
            ? {
                id: row.actor_id,
                username: row.username,
                firstName: row.first_name,
                lastName: row.last_name,
              }
            : null,
          action: row.action,
          entityType: row.entity_type,
          entityId: row.entity_id,
          createdAt: row.created_at,
          metadata: auditData(row.metadata),
          oldData: auditData(row.old_data),
          newData: auditData(row.new_data),
          ip: row.ip_address,
        })),
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  };
}
