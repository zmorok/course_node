import { createAuditRepository } from './audit.repository.js';
import { databaseNow, lockRows, participant, activeUser, plain } from './database-tools.js';

const references = [
  'ref_profile_files',
  'ref_portfolio_files',
  'ref_project_files',
  'ref_order_files',
  'ref_submission_files',
  'ref_complaint_files',
  'ref_review_files',
];
const usedWhere = {
  OR: references.map((name) => ({
    [name]: name === 'ref_profile_files' ? { isNot: null } : { some: {} },
  })),
};

export function createFileRepository(database) {
  return {
    audit: createAuditRepository(database).audit,

    // метод блокировки аккаунта перед изменением файлов пользователя
    async lockActor(id) {
      await lockRows(database, 'users', [id]);

      return database.users.findUnique({ where: { id } });
    },

    // метод подсчёта собственных файлов, не помеченных на удаление
    countOwn: (id) => database.stored_files.count({ where: { uploaded_by: id, deleted_at: null } }),

    // метод сохранения метаданных файла и внутреннего ключа его хранения
    insert: (actorId, file) =>
      database.stored_files.create({
        data: {
          uploaded_by: actorId,
          storage_key: file.storageKey,
          original_name: file.originalName,
          mime_type: file.mimeType,
          size_bytes: file.sizeBytes,
          sha256: file.sha256,
        },
      }),

    // метод получения собственных файлов с признаком использования в сохранённых данных
    async listOwn(actorId) {
      const [rows, used] = await Promise.all([
        database.stored_files.findMany({
          where: { uploaded_by: actorId, deleted_at: null },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        }),
        database.stored_files.findMany({
          where: { uploaded_by: actorId, deleted_at: null, ...usedWhere },
          select: { id: true },
        }),
      ]);
      const ids = new Set(used.map((row) => row.id));

      return rows.map((row) => ({ ...plain(row), in_use: ids.has(row.id) }));
    },

    // метод блокировки выбранных файлов и чтения записей, не помеченных на удаление
    async lockFiles(ids) {
      const locked = await lockRows(database, 'stored_files', ids);

      return plain(
        await database.stored_files.findMany({
          where: { id: { in: locked }, deleted_at: null },
          orderBy: { id: 'asc' },
        }),
      );
    },

    // метод проверки наличия связей файла с профилем, проектами и другими данными приложения
    async used(id) {
      return Boolean(
        await database.stored_files.findFirst({
          where: { id, ...usedWhere },
          select: { id: true },
        }),
      );
    },

    // метод получения файла с учётом владельца, публичных связей и доступа администратора
    async findReadable(id, actorId) {
      const now = await databaseNow(database);
      const client = { role: 'CLIENT', ...activeUser(now) };
      const actor = actorId ? await database.users.findUnique({ where: { id: actorId } }) : null;
      const admin =
        actor?.role === 'ADMIN' &&
        (actor.status === 'ACTIVE' || (actor.blocked_until && actor.blocked_until <= now));
      const access = [
        ...(actorId
          ? [
              { uploaded_by: actorId },
              { ref_order_files: { some: { parent: participant(actorId) } } },
              { ref_submission_files: { some: { parent: { order: participant(actorId) } } } },
            ]
          : []),
        { ref_profile_files: { is: { parent: { user: client } } } },
        { ref_portfolio_files: { some: { parent: { user: client } } } },
        { ref_review_files: { some: { parent: { deleted_at: null, recipient: client } } } },
        { ref_project_files: { some: { parent: { status: 'OPEN', customer: client } } } },
        ...(admin
          ? [
              { ref_complaint_files: { some: {} } },
              { ref_order_files: { some: { parent: { complaints: { some: {} } } } } },
              {
                ref_submission_files: { some: { parent: { order: { complaints: { some: {} } } } } },
              },
              {
                ref_project_files: {
                  some: { parent: { orders: { some: { complaints: { some: {} } } } } },
                },
              },
            ]
          : []),
      ];

      return plain(
        await database.stored_files.findFirst({ where: { id, deleted_at: null, OR: access } }),
      );
    },

    // метод пометки на удаление только файлов без связей с сохранёнными данными
    async markUnusedDeleted(ids) {
      await database.stored_files.updateMany({
        where: { id: { in: ids }, deleted_at: null, NOT: usedWhere },
        data: { deleted_at: await databaseNow(database) },
      });
    },

    // метод получения до ста файлов, ожидающих физического удаления из хранилища
    pendingDeletes: () =>
      database.stored_files.findMany({
        where: { deleted_at: { not: null } },
        select: { id: true, storage_key: true },
        orderBy: { deleted_at: 'asc' },
        take: 100,
      }),

    // метод удаления метаданных ранее помеченного файла после очистки хранилища
    async finishDelete(id) {
      await database.stored_files.deleteMany({ where: { id, deleted_at: { not: null } } });
    },

    // метод получения идентификатора файла текущего аватара
    async avatar(userId) {
      return (
        (await database.profile_files.findUnique({ where: { user_id: userId } }))?.file_id ?? null
      );
    },

    // метод замены или удаления связи с аватаром и обновления даты профиля
    async setAvatar(userId, fileId) {
      await database.profile_files.deleteMany({ where: { user_id: userId } });

      if (fileId)
        await database.profile_files.create({ data: { user_id: userId, file_id: fileId } });

      await database.profiles.updateMany({
        where: { user_id: userId },
        data: { updated_at: await databaseNow(database) },
      });
    },
  };
}
