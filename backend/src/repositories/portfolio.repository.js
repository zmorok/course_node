import { createAuditRepository } from './audit.repository.js';
import { fileInclude, fileData, lockRows, plain, replaceLinks } from './database-tools.js';

const flatten = ({ files, ...row }) => ({
  ...plain(row),
  files: files.map((file) => fileData(file, true)),
});

export function createPortfolioRepository(database) {
  return {
    audit: createAuditRepository(database).audit,

    // метод получения работ портфолио пользователя с доступными вложениями
    async list(userId) {
      return (
        await database.portfolio_items.findMany({
          where: { user_id: userId },
          include: { files: fileInclude },
          orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
        })
      ).map(flatten);
    },

    // метод проверки публичной доступности профиля владельца портфолио
    publicUser: (userId) =>
      database.v_public_profiles.findUnique({
        where: { user_id: userId },
        select: { user_id: true },
      }),

    // метод получения собственной работы портфолио с необязательной блокировкой строки
    async find(id, userId, lock = false) {
      if (lock) await lockRows(database, 'portfolio_items', [id]);

      const row = await database.portfolio_items.findFirst({
        where: { id, user_id: userId },
        include: { files: fileInclude },
      });

      return row ? flatten(row) : undefined;
    },

    // метод создания записи работы портфолио
    async insert(userId, input) {
      return (
        await database.portfolio_items.create({
          data: { user_id: userId, ...input, fileIds: undefined },
        })
      ).id;
    },

    // метод изменения описания, ссылок, опыта и навыков работы портфолио
    async update(id, input) {
      await database.portfolio_items.updateMany({
        where: { id },
        data: { ...input, fileIds: undefined },
      });
    },

    // метод полной замены связей работы портфолио с файлами
    replaceFiles: (id, ids) =>
      replaceLinks(database, 'portfolio_files', 'portfolio_item_id', id, 'file_id', ids),

    // метод удаления записи работы портфолио из базы
    async remove(id) {
      await database.portfolio_items.deleteMany({ where: { id } });
    },
  };
}
