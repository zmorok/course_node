import { AppError } from '../utils/app-error.js';
import { requireFileActor } from './file.service.js';

const missing = () => new AppError(404, 'PORTFOLIO_NOT_FOUND', 'Работа портфолио не найдена');

const toPortfolioItemDto = (row) => ({
  id: row.id,
  title: row.title,
  experience: row.experience,
  skills: row.skills,
  description: row.description,
  links: row.links,
  files: row.files,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export function createPortfolioService({ repository, transaction, fileService }) {
  return {
    // метод получения собственных работ портфолио
    async listOwn(actor) {
      requireFileActor(actor);

      return (await repository.list(actor.id)).map(toPortfolioItemDto);
    },

    // метод получения портфолио публично доступного пользователя
    async listPublic(userId) {
      if (!(await repository.publicUser(userId))) {
        throw new AppError(404, 'PROFILE_NOT_FOUND', 'Профиль не найден');
      }

      return (await repository.list(userId)).map(toPortfolioItemDto);
    },

    // метод получения одной собственной работы портфолио
    async getOwn(actor, id) {
      requireFileActor(actor);

      const row = await repository.find(id, actor.id);

      if (!row) {
        throw missing();
      }

      return toPortfolioItemDto(row);
    },

    // метод создания или изменения работы портфолио с проверкой вложений и очисткой старых файлов
    async save(actor, id, input) {
      const result = await transaction(async (transactionRepository, fileRepository) => {
        requireFileActor(await fileRepository.lockActor(actor.id));

        const previous = id ? await transactionRepository.find(id, actor.id, true) : null;

        if (id && !previous) {
          throw missing();
        }

        if (!id && (await transactionRepository.list(actor.id)).length >= 30) {
          throw new AppError(409, 'PORTFOLIO_QUOTA', 'Можно добавить не более 30 работ');
        }

        const previousIds = previous?.files.map((file) => file.id) ?? [];

        await fileService.attachable(fileRepository, actor.id, input.fileIds, previousIds);

        const itemId = id ?? (await transactionRepository.insert(actor.id, input));

        if (id) {
          await transactionRepository.update(id, input);
        }

        await transactionRepository.replaceFiles(itemId, input.fileIds);
        await fileRepository.markUnusedDeleted(
          previousIds.filter((fileId) => !input.fileIds.includes(fileId)),
        );

        const changed =
          !previous ||
          ['title', 'description', 'links', 'experience', 'skills'].some(
            (key) => JSON.stringify(previous[key]) !== JSON.stringify(input[key]),
          ) ||
          previousIds.length !== input.fileIds.length ||
          input.fileIds.some((fileId) => !previousIds.includes(fileId));

        if (changed) {
          await transactionRepository.audit(
            actor.id,
            id ? 'PORTFOLIO_UPDATED' : 'PORTFOLIO_CREATED',
            'portfolio',
            itemId,
            { fileCount: input.fileIds.length },
          );
        }

        return toPortfolioItemDto(await transactionRepository.find(itemId, actor.id));
      });

      await fileService.drainDeletes();

      return result;
    },

    // метод удаления собственной работы портфолио с очисткой неиспользуемых файлов
    async remove(actor, id) {
      await transaction(async (transactionRepository, fileRepository) => {
        requireFileActor(await fileRepository.lockActor(actor.id));

        const previous = await transactionRepository.find(id, actor.id, true);

        if (!previous) {
          throw missing();
        }

        await transactionRepository.remove(id);
        await fileRepository.markUnusedDeleted(previous.files.map((file) => file.id));
        await transactionRepository.audit(actor.id, 'PORTFOLIO_REMOVED', 'portfolio', id);
      });
      await fileService.drainDeletes();
    },
  };
}
