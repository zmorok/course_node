import { AppError, ValidationError } from '../utils/app-error.js';
import { verifyPassword, hashPassword } from '../utils/password.js';

const missing = () => new AppError(404, 'PROFILE_NOT_FOUND', 'Профиль не найден');
function ownProfile(row) {
  return { id: row.id, email: row.email, username: row.username, firstName: row.first_name, lastName: row.last_name,
    middleName: row.middle_name, gender: row.gender, lastOnlineAt: row.last_online_at, headline: row.headline, description: row.description, phone: row.phone, city: row.city, country: row.country,
    skills: row.skills, avatarFileId: row.avatar_file_id, createdAt: row.created_at, updatedAt: row.updated_at };
}
function requireActive(user) {
  if (!user) throw missing();
  if (user.status === 'BLOCKED' && (!user.blocked_until || new Date(user.blocked_until).getTime() > Date.now())) {
    throw new AppError(403, 'ACCOUNT_BLOCKED', 'Аккаунт заблокирован');
  }
}
export function createProfileService({ repository, transaction }) {
  return {
    async getOwn(actor) {
      const row = await repository.findOwn(actor.id);
      if (!row) throw missing();
      return ownProfile(row);
    },
    async getPublic(userId) {
      const row = await repository.findPublic(userId);
      if (!row) throw missing();
      return { id: row.user_id, username: row.username, firstName: row.first_name, lastName: row.last_name,
        middleName: row.middle_name, gender: row.gender, lastOnlineAt: row.last_online_at, headline: row.headline, description: row.description, city: row.city, country: row.country,
        skills: row.skills, avatarFileId: row.avatar_file_id,
        customerRating: row.customer_rating, customerReviewCount: Number(row.customer_review_count),
        freelancerRating: row.freelancer_rating, freelancerReviewCount: Number(row.freelancer_review_count) };
    },
    async updateOwn(actor, input) {
      try {
        return await transaction(async repo => {
          const user = await repo.lockAccount(actor.id);
          requireActive(user);
          const { currentPassword, ...patch } = input;
          const before=ownProfile(await repo.findOwn(actor.id));
          if (patch.email && patch.email.toLowerCase() !== user.email.toLowerCase()) {
            if (!currentPassword) throw new ValidationError([{ field: 'body.currentPassword', message: 'Для смены email нужен текущий пароль' }]);
            if (!await verifyPassword(user.password_hash, currentPassword)) {
              throw new AppError(403, 'INVALID_CURRENT_PASSWORD', 'Текущий пароль указан неверно', {
                details: [{ field: 'body.currentPassword', message: 'Проверьте текущий пароль' }],
              });
            }
          }
          await repo.updateAccount(actor.id, patch);
          await repo.updateProfile(actor.id, patch);
          const after=ownProfile(await repo.findOwn(actor.id)),fields=Object.keys(patch).filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
          if(fields.length)await repo.audit(actor.id,'PROFILE_UPDATED','user',actor.id,{fields},{oldData:Object.fromEntries(fields.map(key=>[key,before[key]])),newData:Object.fromEntries(fields.map(key=>[key,after[key]]))});
          return after;
        });
      } catch (error) {
        if (error.code === '23505') throw new AppError(409, 'PROFILE_CONFLICT', 'Email или имя пользователя уже заняты');
        throw error;
      }
    },
    async changePassword(actor, input) {
      return transaction(async repo => {
        const user = await repo.lockAccount(actor.id); requireActive(user);
        if (!await verifyPassword(user.password_hash,input.currentPassword)) throw new AppError(403,'INVALID_CURRENT_PASSWORD','Текущий пароль указан неверно');
        if (input.currentPassword === input.newPassword) throw new ValidationError([{field:'body.newPassword',message:'Новый пароль должен отличаться от текущего'}]);
        await repo.updatePassword(actor.id,await hashPassword(input.newPassword));
        await repo.revokeSessions(actor.id);
        await repo.audit(actor.id,'PASSWORD_CHANGED','user',actor.id);
        return {reauthenticate:true};
      });
    },
    async listSkills() { return repository.listSkills(); },
    async replaceSkills(actor, ids) {
      return transaction(async repo => {
        const user = await repo.lockAccount(actor.id);
        requireActive(user);
        if (user.role !== 'CLIENT') throw new AppError(403, 'FORBIDDEN', 'Навыки доступны аккаунту клиента');
        const existing = await repo.findSkillIds(ids);
        if (existing.length !== ids.length) throw new ValidationError([{ field: 'body.skillIds', message: 'Выберите навыки из справочника' }]);
        const before=await repo.findOwn(actor.id);await repo.replaceSkills(actor.id, ids);
        if(before.skills.length!==ids.length||ids.some(id=>!before.skills.some(skill=>skill.id===id)))await repo.audit(actor.id,'SKILLS_CHANGED','user',actor.id,{skillIds:ids});
        return ownProfile(await repo.findOwn(actor.id));
      });
    },
  };
}
