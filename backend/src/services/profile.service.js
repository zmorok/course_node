import { AppError, ValidationError } from '../utils/app-error.js';
import { verifyPassword, hashPassword } from '../utils/password.js';

const missing = () => new AppError(404, 'PROFILE_NOT_FOUND', 'Профиль не найден');

function toOwnProfile(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    middleName: row.middle_name,
    gender: row.gender,
    lastOnlineAt: row.last_online_at,
    headline: row.headline,
    description: row.description,
    phone: row.phone,
    city: row.city,
    country: row.country,
    skills: row.skills,
    avatarFileId: row.avatar_file_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// проверка существования аккаунта и отсутствия действующей блокировки
function requireActiveAccount(user) {
  if (!user) {
    throw missing();
  }

  if (
    user.status === 'BLOCKED' &&
    (!user.blocked_until || new Date(user.blocked_until).getTime() > Date.now())
  ) {
    throw new AppError(403, 'ACCOUNT_BLOCKED', 'Аккаунт заблокирован');
  }
}

export function createProfileService({ repository, transaction }) {
  return {
    // метод получения собственного профиля с контактными данными
    async getOwn(actor) {
      const row = await repository.findOwn(actor.id);

      if (!row) {
        throw missing();
      }

      return toOwnProfile(row);
    },

    // метод получения публичного профиля с навыками и рейтингами
    async getPublic(userId) {
      const row = await repository.findPublic(userId);

      if (!row) {
        throw missing();
      }

      return {
        id: row.user_id,
        username: row.username,
        firstName: row.first_name,
        lastName: row.last_name,
        middleName: row.middle_name,
        gender: row.gender,
        lastOnlineAt: row.last_online_at,
        headline: row.headline,
        description: row.description,
        city: row.city,
        country: row.country,
        skills: row.skills,
        avatarFileId: row.avatar_file_id,
        customerRating: row.customer_rating,
        customerReviewCount: Number(row.customer_review_count),
        freelancerRating: row.freelancer_rating,
        freelancerReviewCount: Number(row.freelancer_review_count),
      };
    },

    // метод изменения своего профиля с проверкой текущего пароля при смене email
    async updateOwn(actor, input) {
      try {
        return await transaction(async (transactionRepository) => {
          const user = await transactionRepository.lockAccount(actor.id);

          requireActiveAccount(user);

          const { currentPassword, ...patch } = input;
          const before = toOwnProfile(await transactionRepository.findOwn(actor.id));

          if (patch.email && patch.email.toLowerCase() !== user.email.toLowerCase()) {
            if (!currentPassword) {
              throw new ValidationError([
                { field: 'body.currentPassword', message: 'Для смены email нужен текущий пароль' },
              ]);
            }

            if (!(await verifyPassword(user.password_hash, currentPassword))) {
              throw new AppError(403, 'INVALID_CURRENT_PASSWORD', 'Текущий пароль указан неверно', {
                details: [{ field: 'body.currentPassword', message: 'Проверьте текущий пароль' }],
              });
            }
          }

          await transactionRepository.updateAccount(actor.id, patch);
          await transactionRepository.updateProfile(actor.id, patch);

          const after = toOwnProfile(await transactionRepository.findOwn(actor.id));
          const fields = Object.keys(patch).filter(
            (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
          );

          if (fields.length) {
            await transactionRepository.audit(
              actor.id,
              'PROFILE_UPDATED',
              'user',
              actor.id,
              { fields },
              {
                oldData: Object.fromEntries(fields.map((key) => [key, before[key]])),
                newData: Object.fromEntries(fields.map((key) => [key, after[key]])),
              },
            );
          }

          return after;
        });
      } catch (error) {
        if (error.code === '23505') {
          throw new AppError(409, 'PROFILE_CONFLICT', 'Email или имя пользователя уже заняты');
        }

        throw error;
      }
    },

    // метод смены пароля с проверкой текущего и отзывом всех сессий
    async changePassword(actor, input) {
      return transaction(async (transactionRepository) => {
        const user = await transactionRepository.lockAccount(actor.id);

        requireActiveAccount(user);

        if (!(await verifyPassword(user.password_hash, input.currentPassword))) {
          throw new AppError(403, 'INVALID_CURRENT_PASSWORD', 'Текущий пароль указан неверно');
        }

        if (input.currentPassword === input.newPassword) {
          throw new ValidationError([
            { field: 'body.newPassword', message: 'Новый пароль должен отличаться от текущего' },
          ]);
        }

        await transactionRepository.updatePassword(actor.id, await hashPassword(input.newPassword));
        await transactionRepository.revokeSessions(actor.id);
        await transactionRepository.audit(actor.id, 'PASSWORD_CHANGED', 'user', actor.id);

        return { reauthenticate: true };
      });
    },

    // метод получения справочника доступных навыков
    async listSkills() {
      return repository.listSkills();
    },

    // метод замены собственных навыков с проверкой их наличия в справочнике
    async replaceSkills(actor, ids) {
      return transaction(async (transactionRepository) => {
        const user = await transactionRepository.lockAccount(actor.id);

        requireActiveAccount(user);

        if (user.role !== 'CLIENT') {
          throw new AppError(403, 'FORBIDDEN', 'Навыки доступны аккаунту клиента');
        }

        const existing = await transactionRepository.findSkillIds(ids);

        if (existing.length !== ids.length) {
          throw new ValidationError([
            { field: 'body.skillIds', message: 'Выберите навыки из справочника' },
          ]);
        }

        const before = await transactionRepository.findOwn(actor.id);

        await transactionRepository.replaceSkills(actor.id, ids);

        if (
          before.skills.length !== ids.length ||
          ids.some((id) => !before.skills.some((skill) => skill.id === id))
        ) {
          await transactionRepository.audit(actor.id, 'SKILLS_CHANGED', 'user', actor.id, {
            skillIds: ids,
          });
        }

        return toOwnProfile(await transactionRepository.findOwn(actor.id));
      });
    },
  };
}
