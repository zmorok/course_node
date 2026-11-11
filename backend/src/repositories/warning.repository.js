import { createSourceRepository } from './source.repository.js';
import { databaseNow, date, page, newest, userInclude } from './database-tools.js';

export function createWarningRepository(database) {
  return {
    ...createSourceRepository(database),

    // метод получения предупреждений и блокировок пользователя с именами администраторов
    async list(actorId, query) {
      const result = await page(database, 'moderation_actions', query, {
        where: {
          target_id: actorId,
          action_type: query.type ?? { in: ['WARNING', 'TEMPORARY_BLOCK', 'PERMANENT_BLOCK'] },
        },
        include: { warning: true, admin: userInclude },
        orderBy: newest,
      });

      return {
        ...result,
        items: result.items.map(({ warning, admin, ...row }) => ({
          ...row,
          moderation_action_id: row.id,
          warning_id: warning?.id ?? null,
          message: warning?.message ?? null,
          first_name: admin.profile.first_name,
          last_name: admin.profile.last_name,
        })),
      };
    },

    // метод создания связанных записей санкции и предупреждения с общей датой выдачи
    async create(adminId, targetId, input, complaintId = null) {
      const now = await databaseNow(database);
      const expiresAt = date(input.expiresAt);
      const action = await database.moderation_actions.create({
        data: {
          admin_id: adminId,
          target_id: targetId,
          complaint_id: complaintId,
          action_type: 'WARNING',
          reason: input.message,
          expires_at: expiresAt,
          created_at: now,
        },
      });
      const warning = await database.warnings.create({
        data: {
          moderation_action_id: action.id,
          user_id: targetId,
          issued_by: adminId,
          message: input.message,
          expires_at: expiresAt,
          created_at: action.created_at,
        },
      });

      return { id: warning.id, actionId: action.id };
    },

    // метод сохранения уведомления пользователю о выданном предупреждении
    async notify(targetId, actionId) {
      await database.notifications.create({
        data: {
          recipient_id: targetId,
          event_type: 'MODERATION_ACTION',
          moderation_action_id: actionId,
          message: 'Вам выдано предупреждение администратора',
        },
      });
    },
  };
}
