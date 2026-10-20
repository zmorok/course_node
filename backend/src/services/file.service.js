import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/app-error.js';
import { inspectFile } from './file-policy.js';

export const fileMissing = () => new AppError(404, 'FILE_NOT_FOUND', 'Файл не найден');
export const fileDto = row => ({ id: row.id, originalName: row.original_name, mimeType: row.mime_type,
  sizeBytes: Number(row.size_bytes), sha256: row.sha256, createdAt: row.created_at,
  ...(row.in_use === undefined ? {} : { inUse: row.in_use }) });
export function requireFileActor(actor) {
  if (!actor) throw new AppError(401, 'UNAUTHENTICATED', 'Войдите в аккаунт');
  if (actor.status === 'BLOCKED' && (!actor.blocked_until || new Date(actor.blocked_until).getTime() > Date.now())) throw new AppError(403, 'ACCOUNT_BLOCKED', 'Аккаунт заблокирован');
  if (actor.role !== 'CLIENT') throw new AppError(403, 'FORBIDDEN', 'Действие доступно аккаунту клиента');
}
export function createFileService({ repository, transaction, storage, logger = console }) {
  let cleanup;
  const service = {
    async listOwn(actor) { requireFileActor(actor); return (await repository.listOwn(actor.id)).map(fileDto); },
    async upload(actor, input) {
      requireFileActor(actor);
      const file = await inspectFile(input), storageKey = `${randomUUID()}${file.extension}`;
      let saved = false;
      try {
        const row = await transaction(async repo => {
          requireFileActor(await repo.lockActor(actor.id));
          if (await repo.countOwn(actor.id) >= 50) throw new AppError(409, 'FILE_QUOTA', 'Можно хранить не более 50 файлов. Удалите ненужные');
          await storage.save(storageKey, input.buffer); saved = true;
          const row=await repo.insert(actor.id, { ...file, storageKey });await repo.audit(actor.id,'FILE_UPLOADED','file',row.id,{mimeType:row.mime_type,sizeBytes:Number(row.size_bytes)});return row;
        });
        return fileDto(row);
      } catch (error) {
        if (saved) await storage.remove(storageKey).catch(() => logger.error(JSON.stringify({ event: 'upload_cleanup_failed' })));
        throw error;
      }
    },
    async open(id, actor) {
      const row = await repository.findReadable(id, actor?.id);
      if (!row) throw fileMissing();
      let object;
      try { object = await storage.open(row.storage_key); }
      catch (error) { if (error.code === 'ENOENT') throw fileMissing(); throw error; }
      if (object.size !== Number(row.size_bytes)) { object.stream.destroy(); throw new AppError(503, 'STORAGE_UNAVAILABLE', 'Файл временно недоступен'); }
      return { file: fileDto(row), stream: object.stream };
    },
    async remove(actor, id) {
      await transaction(async repo => {
        requireFileActor(await repo.lockActor(actor.id));
        const [row] = await repo.lockFiles([id]);
        if (!row || row.uploaded_by !== actor.id) throw fileMissing();
        if (await repo.used(id)) throw new AppError(409, 'FILE_IN_USE', 'Файл связан с сохранёнными данными. Удалить его нельзя');
        await repo.markUnusedDeleted([id]);
        await repo.audit(actor.id,'FILE_REMOVED','file',id);
      });
      await service.drainDeletes();
    },
    async attachable(repo, actorId, ids, retained = []) {
      const rows = await repo.lockFiles(ids);
      if (rows.length !== ids.length || rows.some(row => row.uploaded_by !== actorId)) throw fileMissing();
      for (const row of rows) if (!retained.includes(row.id) && await repo.used(row.id)) throw new AppError(409, 'FILE_IN_USE', 'Файл уже используется. Загрузите отдельную копию');
      return rows;
    },
    async getAvatar(actor) { return repository.avatar(actor.id); },
    async setAvatar(actor, id) {
      await transaction(async repo => {
        requireFileActor(await repo.lockActor(actor.id));
        const previous = await repo.avatar(actor.id);
        if (id) {
          const [row] = await service.attachable(repo, actor.id, [id], previous ? [previous] : []);
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(row.mime_type)) throw new AppError(422, 'AVATAR_TYPE', 'Для аватара выберите PNG, JPEG или WebP');
        }
        await repo.setAvatar(actor.id, id);
        if (previous && previous !== id) await repo.markUnusedDeleted([previous]);
        if(previous!==id)await repo.audit(actor.id,'AVATAR_CHANGED','user',actor.id,{}, {oldData:{avatarFileId:previous},newData:{avatarFileId:id}});
      });
      await service.drainDeletes();
      return id;
    },
    drainDeletes() {
      if (!cleanup) cleanup = (async () => {
        try {
          for (const row of await repository.pendingDeletes()) {
            try { await storage.remove(row.storage_key); await repository.finishDelete(row.id); }
            catch { logger.error(JSON.stringify({ event: 'file_delete_deferred' })); }
          }
        } catch { logger.error(JSON.stringify({ event: 'file_cleanup_deferred' })); }
      })().finally(() => { cleanup = undefined; });
      return cleanup;
    },
  };
  return service;
}
