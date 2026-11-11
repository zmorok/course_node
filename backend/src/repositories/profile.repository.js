import { createAuditRepository } from './audit.repository.js';
import {
  databaseNow,
  lockRows,
  fields,
  skillInclude,
  skillData,
  plain,
  replaceLinks,
} from './database-tools.js';

const accountColumns = { email: 'email', username: 'username' };
const profileColumns = {
  middleName: 'middle_name',
  gender: 'gender',
  firstName: 'first_name',
  lastName: 'last_name',
  headline: 'headline',
  description: 'description',
  phone: 'phone',
  city: 'city',
  country: 'country',
};

export function createProfileRepository(database) {
  return {
    audit: createAuditRepository(database).audit,

    // метод получения собственного профиля с контактами, навыками и текущим аватаром
    async findOwn(userId) {
      const user = await database.users.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          username: true,
          last_online_at: true,
          profile: { include: { avatar: true } },
          skills: skillInclude,
        },
      });

      if (!user?.profile) return undefined;

      const { profile, skills, ...row } = user;

      return {
        ...profile,
        ...row,
        avatar_file_id: profile.avatar?.file_id ?? null,
        skills: skills.map(skillData),
      };
    },

    // метод получения публичного профиля с рейтингами и навыками
    async findPublic(userId) {
      const row = await database.v_public_profiles.findUnique({ where: { user_id: userId } });

      if (!row) return undefined;

      return {
        ...plain(row),
        skills: (
          await database.user_skills.findMany({ where: { user_id: userId }, ...skillInclude })
        ).map(skillData),
      };
    },

    // метод блокировки и повторного чтения аккаунта перед изменением профиля
    async lockAccount(id) {
      await lockRows(database, 'users', [id]);

      return database.users.findUnique({ where: { id } });
    },

    // метод сохранения переданного хеша нового пароля
    async updatePassword(id, hash) {
      await database.users.updateMany({ where: { id }, data: { password_hash: hash } });
    },

    // метод отзыва всех ещё действующих сессий пользователя
    async revokeSessions(id) {
      await database.auth_sessions.updateMany({
        where: { user_id: id, revoked_at: null },
        data: { revoked_at: await databaseNow(database) },
      });
    },

    // метод изменения разрешённых полей email и имени пользователя
    async updateAccount(id, patch) {
      const data = fields(patch, accountColumns);

      if (Object.keys(data).length) await database.users.updateMany({ where: { id }, data });
    },

    // метод изменения разрешённых полей профиля с обновлением даты изменения
    async updateProfile(id, patch) {
      const data = fields(patch, profileColumns);

      if (!Object.keys(data).length) data.updated_at = await databaseNow(database);

      await database.profiles.updateMany({ where: { user_id: id }, data });
    },

    // метод получения отсортированного справочника навыков
    listSkills: () =>
      database.skills.findMany({
        select: { id: true, slug: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),

    // метод проверки существования навыков с блокировкой от их параллельного изменения
    async findSkillIds(ids) {
      return lockRows(database, 'skills', ids, true);
    },

    // метод полной замены связей пользователя с навыками и обновления даты профиля
    async replaceSkills(id, ids) {
      await replaceLinks(database, 'user_skills', 'user_id', id, 'skill_id', ids);
      await database.profiles.updateMany({
        where: { user_id: id },
        data: { updated_at: await databaseNow(database) },
      });
    },
  };
}
