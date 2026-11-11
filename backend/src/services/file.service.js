import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/app-error.js';
import { inspectFile } from './file-policy.js';

export const fileMissing = () => new AppError(404, 'FILE_NOT_FOUND', 'Файл не найден');

export const fileDto = (row) => ({
  id: row.id,
  originalName: row.original_name,
  mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes),
  sha256: row.sha256,
  createdAt: row.created_at,
  ...(row.in_use === undefined ? {} : { inUse: row.in_use }),
});

// проверка входа в аккаунт, отсутствия действующей блокировки и роли клиента
export function requireFileActor(actor) {
  if (!actor) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт');
  }

  if (
    actor.status === 'BLOCKED' &&
    (!actor.blocked_until || new Date(actor.blocked_until).getTime() > Date.now())
  ) {
    throw new AppError(403, 'ACCOUNT_BLOCKED', 'Аккаунт заблокирован');
  }

  if (actor.role !== 'CLIENT') {
    throw new AppError(403, 'FORBIDDEN', 'Действие доступно аккаунту клиента');
  }
}

export function createFileService({ repository, transaction, storage, logger = console }) {
  let cleanup;

  const service = {
    // метод получения метаданных собственных файлов
    async listOwn(actor) {
      requireFileActor(actor);

      return (await repository.listOwn(actor.id)).map(fileDto);
    },

    // метод проверки и сохранения файла с удалением сохранённой копии при ошибке транзакции
    async upload(actor, input) {
      requireFileActor(actor);

      const file = await inspectFile(input);
      const storageKey = `${randomUUID()}${file.extension}`;
      let saved = false;

      try {
        const row = await transaction(async (transactionRepository) => {
          requireFileActor(await transactionRepository.lockActor(actor.id));

          if ((await transactionRepository.countOwn(actor.id)) >= 50) {
            throw new AppError(
              409,
              'FILE_QUOTA',
              'Можно хранить не более 50 файлов. Удалите ненужные',
            );
          }

          await storage.save(storageKey, input.buffer);
          saved = true;

          const row = await transactionRepository.insert(actor.id, { ...file, storageKey });

          await transactionRepository.audit(actor.id, 'FILE_UPLOADED', 'file', row.id, {
            mimeType: row.mime_type,
            sizeBytes: Number(row.size_bytes),
          });

          return row;
        });

        return fileDto(row);
      } catch (error) {
        if (saved) {
          await storage
            .remove(storageKey)
            .catch(() => logger.error(JSON.stringify({ event: 'upload_cleanup_failed' })));
        }

        throw error;
      }
    },

    // метод открытия доступного файла для чтения с проверкой его наличия и размера
    async open(id, actor) {
      const row = await repository.findReadable(id, actor?.id);

      if (!row) {
        throw fileMissing();
      }

      let object;

      try {
        object = await storage.open(row.storage_key);
      } catch (error) {
        if (error.code === 'ENOENT') {
          throw fileMissing();
        }

        throw error;
      }

      if (object.size !== Number(row.size_bytes)) {
        object.stream.destroy();
        throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Файл временно недоступен');
      }

      return { file: fileDto(row), stream: object.stream };
    },

    // метод удаления собственного файла, который не связан с сохранёнными данными
    async remove(actor, id) {
      await transaction(async (transactionRepository) => {
        requireFileActor(await transactionRepository.lockActor(actor.id));

        const [row] = await transactionRepository.lockFiles([id]);

        if (!row || row.uploaded_by !== actor.id) {
          throw fileMissing();
        }

        if (await transactionRepository.used(id)) {
          throw new AppError(
            409,
            'FILE_IN_USE',
            'Файл связан с сохранёнными данными. Удалить его нельзя',
          );
        }

        await transactionRepository.markUnusedDeleted([id]);
        await transactionRepository.audit(actor.id, 'FILE_REMOVED', 'file', id);
      });
      await service.drainDeletes();
    },

    // метод проверки принадлежности файлов и возможности прикрепить их к данным
    async attachable(transactionRepository, actorId, ids, retained = []) {
      const rows = await transactionRepository.lockFiles(ids);

      if (rows.length !== ids.length || rows.some((row) => row.uploaded_by !== actorId)) {
        throw fileMissing();
      }

      for (const row of rows) {
        if (!retained.includes(row.id) && (await transactionRepository.used(row.id))) {
          throw new AppError(
            409,
            'FILE_IN_USE',
            'Файл уже используется. Загрузите отдельную копию',
          );
        }
      }

      return rows;
    },

    // метод получения идентификатора текущего аватара
    async getAvatar(actor) {
      return repository.avatar(actor.id);
    },

    // метод установки или удаления аватара с очисткой прежнего неиспользуемого файла
    async setAvatar(actor, id) {
      await transaction(async (transactionRepository) => {
        requireFileActor(await transactionRepository.lockActor(actor.id));

        const previous = await transactionRepository.avatar(actor.id);

        if (id) {
          const [row] = await service.attachable(
            transactionRepository,
            actor.id,
            [id],
            previous ? [previous] : [],
          );

          if (
            ![
              'image/jpeg',
              'image/png',
              'image/webp',
              'image/gif',
              'image/bmp',
              'image/x-ms-bmp',
            ].includes(row.mime_type)
          ) {
            throw new AppError(
              422,
              'AVATAR_TYPE',
              'Для аватара выберите PNG, JPEG, GIF, BMP или WebP',
            );
          }
        }

        await transactionRepository.setAvatar(actor.id, id);

        if (previous && previous !== id) {
          await transactionRepository.markUnusedDeleted([previous]);
        }

        if (previous !== id) {
          await transactionRepository.audit(
            actor.id,
            'AVATAR_CHANGED',
            'user',
            actor.id,
            {},
            { oldData: { avatarFileId: previous }, newData: { avatarFileId: id } },
          );
        }
      });
      await service.drainDeletes();

      return id;
    },

    // метод очистки файлов, помеченных на удаление, с общим запуском для параллельных вызовов
    drainDeletes() {
      if (!cleanup) {
        cleanup = (async () => {
          try {
            for (const row of await repository.pendingDeletes()) {
              try {
                await storage.remove(row.storage_key);
                await repository.finishDelete(row.id);
              } catch {
                logger.error(JSON.stringify({ event: 'file_delete_deferred' }));
              }
            }
          } catch {
            logger.error(JSON.stringify({ event: 'file_cleanup_deferred' }));
          }
        })().finally(() => {
          cleanup = undefined;
        });
      }

      return cleanup;
    },
  };

  return service;
}
