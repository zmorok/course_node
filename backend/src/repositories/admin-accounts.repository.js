import { createAuthRepository } from './auth.repository.js';
import {
  lockAccountChanges,
  databaseNow,
  fields,
  activeUser,
  activeStatuses,
} from './database-tools.js';

const account = {
  email: 'email',
  username: 'username',
  role: 'role',
  passwordHash: 'password_hash',
};
const profile = {
  firstName: 'first_name',
  lastName: 'last_name',
  middleName: 'middle_name',
  gender: 'gender',
  phone: 'phone',
  headline: 'headline',
  description: 'description',
  city: 'city',
  country: 'country',
};

export function createAdminAccountsRepository(database) {
  return {
    // метод блокировки параллельных административных изменений аккаунтов
    lockAccountChanges: () => lockAccountChanges(database),

    // метод получения записи аккаунта по идентификатору
    account: (id) => database.users.findUnique({ where: { id } }),

    // метод подсчёта неудалённых администраторов без действующей блокировки
    async activeAdmins() {
      return database.users.count({
        where: { role: 'ADMIN', deleted_at: null, ...activeUser(await databaseNow(database)) },
      });
    },

    // метод проверки участия аккаунта в активных заказах или рассмотрении жалоб
    async accountInUse(id) {
      return (
        Boolean(
          await database.orders.findFirst({
            where: {
              OR: [{ customer_id: id }, { freelancer_id: id }],
              status: { in: activeStatuses },
            },
            select: { id: true },
          }),
        ) ||
        Boolean(
          await database.complaints.findFirst({
            where: { assigned_admin_id: id, status: 'IN_REVIEW' },
            select: { id: true },
          }),
        )
      );
    },

    // метод создания аккаунта с профилем и применения административных настроек
    async insertAccount(input, passwordHash) {
      const user = await createAuthRepository(database).createUser({ ...input, passwordHash });

      await this.patchAccount(user.id, input);

      return user.id;
    },

    // метод изменения только разрешённых полей аккаунта и профиля
    async patchAccount(id, input) {
      const userData = fields(input, account),
        profileData = fields(input, profile);

      if (Object.keys(userData).length)
        await database.users.updateMany({ where: { id }, data: userData });

      if (Object.keys(profileData).length)
        await database.profiles.updateMany({ where: { user_id: id }, data: profileData });
    },

    // метод обезличивания и пометки аккаунта как удалённого с блокировкой доступа
    async deleteAccount(id, actorId, reason) {
      const now = await databaseNow(database);

      await database.users.updateMany({
        where: { id },
        data: {
          deleted_at: now,
          email: 'deleted-' + id + '@example.invalid',
          username: 'deleted_' + id.replaceAll('-', ''),
          status: 'BLOCKED',
          blocked_by: actorId,
          blocked_at: now,
          blocked_until: null,
          block_reason: reason,
        },
      });
      await database.profiles.updateMany({
        where: { user_id: id },
        data: {
          first_name: 'Удалённый',
          last_name: 'пользователь',
          middle_name: null,
          gender: null,
          phone: null,
          headline: '',
          description: '',
          city: null,
          country: null,
        },
      });
    },
  };
}
