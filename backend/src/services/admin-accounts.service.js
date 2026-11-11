import { AppError } from '../utils/app-error.js';
import { requireAdmin } from './admin-policy.js';
import { hashPassword } from '../utils/password.js';

const missing = () => new AppError(404, 'USER_NOT_FOUND', 'Пользователь не найден');

export function createAdminAccountsService({ repository, transaction, dto: toUserDto }) {
  // выполнение операции с аккаунтом в транзакции с повторной проверкой прав
  async function runAccountOperation(actor, id, operation) {
    requireAdmin(actor);

    try {
      return await transaction(async (transactionRepository) => {
        await transactionRepository.lockAccountChanges();

        const users = await transactionRepository.lockUsers(id ? [actor.id, id] : [actor.id]);

        requireAdmin(users.find((user) => user.id === actor.id));

        const target = id ? await transactionRepository.account(id) : null;

        if (id && (!target || target.deleted_at)) {
          throw missing();
        }

        return operation(transactionRepository, target);
      });
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(409, 'ACCOUNT_EXISTS', 'Email или имя пользователя уже заняты');
      }

      throw error;
    }
  }

  // проверка смены роли с защитой последнего администратора и активных связей
  async function canChangeRole(transactionRepository, target, next) {
    if (target.role === next) {
      return;
    }

    if (target.role === 'ADMIN' && (await transactionRepository.activeAdmins()) <= 1) {
      throw new AppError(
        409,
        'LAST_ADMIN',
        'Нельзя удалить или понизить последнего администратора',
      );
    }

    if (await transactionRepository.accountInUse(target.id)) {
      throw new AppError(
        409,
        'ACCOUNT_IN_USE',
        'Сначала завершите активные заказы или рассмотрение назначенных жалоб',
      );
    }
  }

  return {
    // метод создания аккаунта администратором с хешированием пароля
    createUser: (actor, input) =>
      runAccountOperation(actor, null, async (transactionRepository) => {
        const id = await transactionRepository.insertAccount(
          input,
          await hashPassword(input.password),
        );

        await transactionRepository.audit(actor.id, 'ADMIN_USER_CREATED', 'user', id, {
          role: input.role,
        });

        return { user: toUserDto(await transactionRepository.user(id)) };
      }),

    // метод изменения аккаунта с отзывом сессий при смене важных данных
    updateUser: (actor, id, input) =>
      runAccountOperation(actor, id, async (transactionRepository, target) => {
        if (input.role) {
          await canChangeRole(transactionRepository, target, input.role);
        }

        const before = toUserDto(await transactionRepository.user(id));
        const { newPassword, ...patch } = input;

        if (newPassword) {
          patch.passwordHash = await hashPassword(newPassword);
        }

        await transactionRepository.patchAccount(id, patch);

        if (
          newPassword ||
          (patch.role && patch.role !== target.role) ||
          (patch.email && patch.email.toLowerCase() !== target.email.toLowerCase())
        ) {
          await transactionRepository.revokeSessions(id);
        }

        const after = toUserDto(await transactionRepository.user(id));

        await transactionRepository.audit(
          actor.id,
          'ADMIN_USER_UPDATED',
          'user',
          id,
          {
            fields: Object.keys(input).filter((key) => key !== 'newPassword'),
            passwordReset: Boolean(newPassword),
          },
          { oldData: before, newData: after },
        );

        return { user: after };
      }),

    // метод удаления аккаунта с защитой последнего администратора и активных связей
    deleteUser: (actor, id, input) =>
      runAccountOperation(actor, id, async (transactionRepository, target) => {
        if (target.role === 'ADMIN' && (await transactionRepository.activeAdmins()) <= 1) {
          throw new AppError(409, 'LAST_ADMIN', 'Нельзя удалить последнего администратора');
        }

        if (await transactionRepository.accountInUse(id)) {
          throw new AppError(
            409,
            'ACCOUNT_IN_USE',
            'Сначала завершите активные заказы или рассмотрение назначенных жалоб',
          );
        }

        await transactionRepository.deleteAccount(id, actor.id, input.reason);
        await transactionRepository.revokeSessions(id);
        await transactionRepository.audit(actor.id, 'ADMIN_USER_DELETED', 'user', id, {
          reason: input.reason,
        });

        return { removed: true };
      }),
  };
}
