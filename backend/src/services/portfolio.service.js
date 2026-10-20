import { AppError } from '../utils/app-error.js';
import { requireFileActor } from './file.service.js';
const missing = () => new AppError(404,'PORTFOLIO_NOT_FOUND','Работа портфолио не найдена');
const dto = row => ({ id: row.id, title: row.title, description: row.description, links: row.links,
  files: row.files, createdAt: row.created_at, updatedAt: row.updated_at });
export function createPortfolioService({ repository, transaction, fileService }) {
  return {
    async listOwn(actor) { requireFileActor(actor); return (await repository.list(actor.id)).map(dto); },
    async listPublic(userId) {
      if (!await repository.publicUser(userId)) throw new AppError(404,'PROFILE_NOT_FOUND','Профиль не найден');
      return (await repository.list(userId)).map(dto);
    },
    async getOwn(actor,id) {
      requireFileActor(actor); const row = await repository.find(id,actor.id);
      if (!row) throw missing(); return dto(row);
    },
    async save(actor,id,input) {
      const result = await transaction(async (repo,files) => {
        requireFileActor(await files.lockActor(actor.id));
        const previous = id ? await repo.find(id,actor.id,true) : null;
        if (id && !previous) throw missing();
        if (!id && (await repo.list(actor.id)).length >= 30) throw new AppError(409,'PORTFOLIO_QUOTA','Можно добавить не более 30 работ');
        const previousIds = previous?.files.map(file => file.id) ?? [];
        await fileService.attachable(files,actor.id,input.fileIds,previousIds);
        const itemId = id ?? await repo.insert(actor.id,input);
        if (id) await repo.update(id,input);
        await repo.replaceFiles(itemId,input.fileIds);
        await files.markUnusedDeleted(previousIds.filter(fileId => !input.fileIds.includes(fileId)));
        const changed=!previous||['title','description','links'].some(key=>JSON.stringify(previous[key])!==JSON.stringify(input[key]))||previousIds.length!==input.fileIds.length||input.fileIds.some(fileId=>!previousIds.includes(fileId));
        if(changed)await repo.audit(actor.id,id?'PORTFOLIO_UPDATED':'PORTFOLIO_CREATED','portfolio',itemId,{fileCount:input.fileIds.length});
        return dto(await repo.find(itemId,actor.id));
      });
      await fileService.drainDeletes(); return result;
    },
    async remove(actor,id) {
      await transaction(async (repo,files) => {
        requireFileActor(await files.lockActor(actor.id));
        const previous = await repo.find(id,actor.id,true);
        if (!previous) throw missing();
        await repo.remove(id);
        await files.markUnusedDeleted(previous.files.map(file => file.id));
        await repo.audit(actor.id,'PORTFOLIO_REMOVED','portfolio',id);
      });
      await fileService.drainDeletes();
    },
  };
}
