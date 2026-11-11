import { createAuditRepository } from './audit.repository.js';
import {
  databaseNow,
  lockRows,
  plain,
  page,
  date,
  replaceLinks,
  blockingStatuses,
  activeUser,
  fileInclude,
  fileData,
  skillInclude,
  skillData,
} from './database-tools.js';

export const projectInclude = {
  customer: { include: { profile: true } },
  category: true,
  skills: skillInclude,
  files: fileInclude,
};

export function projectData({ customer, category, skills, files, ...row }, now) {
  return {
    ...plain(row),
    username: customer.username,
    first_name: customer.profile.first_name,
    last_name: customer.profile.last_name,
    category_slug: category?.slug ?? null,
    category_name: category?.name ?? null,
    customer_active:
      customer.role === 'CLIENT' &&
      (customer.status === 'ACTIVE' || (customer.blocked_until && customer.blocked_until <= now)),
    skills: skills.map(skillData),
    files: files.map((link) => fileData(link, true)),
  };
}

const projectInput = (input) => ({
  title: input.title,
  description: input.description,
  category_id: input.categoryId,
  budget: input.budget,
  desired_deadline_at: date(input.desiredDeadlineAt),
});

export function createProjectRepository(database) {
  return {
    audit: createAuditRepository(database).audit,

    // метод получения отсортированного справочника категорий проектов
    categories: () =>
      database.categories.findMany({
        select: { id: true, slug: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),

    // метод поиска публичных или собственных проектов с фильтрами и пагинацией
    async list(query, ownerId) {
      const now = await databaseNow(database);
      const where = {
        ...(ownerId
          ? { customer_id: ownerId }
          : { status: 'OPEN', customer: { role: 'CLIENT', ...activeUser(now) } }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: { slug: query.category } } : {}),
        ...(query.skill ? { skills: { some: { skill: { slug: query.skill } } } } : {}),
      };

      if (query.minBudget !== undefined || query.maxBudget !== undefined)
        where.budget = { gte: query.minBudget, lte: query.maxBudget };

      const stamp = ownerId ? 'created_at' : 'published_at';
      const sorts = {
        newest: [{ [stamp]: 'desc' }, { id: 'desc' }],
        oldest: [{ [stamp]: 'asc' }, { id: 'asc' }],
        budget_asc: [{ budget: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        budget_desc: [{ budget: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
        deadline_asc: [{ desired_deadline_at: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      };
      const options = { where, include: projectInclude, orderBy: sorts[query.sort] };

      if (query.search) {
        const rows = (await database.projects.findMany(options)).filter((row) =>
          (row.title + ' ' + row.description).toLowerCase().includes(query.search.toLowerCase()),
        );

        return {
          total: rows.length,
          items: rows
            .slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
            .map((row) => projectData(row, now)),
        };
      }

      const result = await page(database, 'projects', query, options);

      return { ...result, items: result.items.map((row) => projectData(row, now)) };
    },

    // метод получения собственного проекта или открытого проекта доступного заказчика
    async findVisible(id, actorId) {
      const now = await databaseNow(database);
      const row = await database.projects.findFirst({
        where: {
          id,
          OR: [
            ...(actorId ? [{ customer_id: actorId }] : []),
            { status: 'OPEN', customer: { role: 'CLIENT', ...activeUser(now) } },
          ],
        },
        include: projectInclude,
      });

      return row ? projectData(row, now) : undefined;
    },

    // метод блокировки и чтения проекта, принадлежащего текущему заказчику
    async lockOwn(id, actorId) {
      await lockRows(database, 'projects', [id]);

      return plain(await database.projects.findFirst({ where: { id, customer_id: actorId } }));
    },

    // метод подсчёта всех проектов текущего заказчика
    countOwn: (actorId) => database.projects.count({ where: { customer_id: actorId } }),

    // метод проверки категории и навыков с блокировкой записей справочников
    async validReferences(categoryId, skillIds) {
      return {
        category:
          !categoryId || (await lockRows(database, 'categories', [categoryId], true)).length === 1,
        skills: (await lockRows(database, 'skills', skillIds, true)).length === skillIds.length,
      };
    },

    // метод сохранения нового проекта в состоянии черновика
    async insert(actorId, input) {
      return (
        await database.projects.create({ data: { customer_id: actorId, ...projectInput(input) } })
      ).id;
    },

    // метод изменения условий проекта без смены его статуса
    async update(id, input) {
      await database.projects.updateMany({ where: { id }, data: projectInput(input) });
    },

    // метод получения идентификаторов навыков, связанных с проектом
    async skills(id) {
      return (
        await database.project_skills.findMany({
          where: { project_id: id },
          orderBy: { skill_id: 'asc' },
        })
      ).map((row) => row.skill_id);
    },

    // метод получения идентификаторов файлов, связанных с проектом
    async files(id) {
      return (
        await database.project_files.findMany({
          where: { project_id: id },
          orderBy: { file_id: 'asc' },
        })
      ).map((row) => row.file_id);
    },

    // метод полной замены связей проекта с навыками
    replaceSkills: (id, ids) =>
      replaceLinks(database, 'project_skills', 'project_id', id, 'skill_id', ids),

    // метод полной замены связей проекта с файлами
    replaceFiles: (id, ids) =>
      replaceLinks(database, 'project_files', 'project_id', id, 'file_id', ids),

    // метод открытия проекта для предложений с сохранением даты публикации
    async publish(id) {
      await database.projects.updateMany({
        where: { id },
        data: { status: 'OPEN', published_at: await databaseNow(database) },
      });
    },

    // метод сохранения отмены проекта с причиной и датой
    async cancel(id, reason) {
      await database.projects.updateMany({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelled_at: await databaseNow(database),
          cancellation_reason: reason,
        },
      });
    },

    // метод закрытия ожидающих откликов и приглашений по указанной причине
    async closePending(id, reason) {
      const now = await databaseNow(database);
      const proposals = await database.proposals.updateManyAndReturn({
        where: { project_id: id, status: 'PENDING' },
        data: { status: 'REJECTED', decided_at: now, closure_reason: reason },
      });
      const invitations = await database.project_invitations.updateManyAndReturn({
        where: { project_id: id, status: 'PENDING' },
        data: { status: 'EXPIRED', decided_at: now, closure_reason: reason },
      });

      return { proposals: plain(proposals), invitations: plain(invitations) };
    },

    // метод сохранения уведомления о закрытии отклика или приглашения
    async notifyClosed(recipientId, kind, sourceId, projectId, status, reason) {
      await database.notifications.create({
        data: {
          recipient_id: recipientId,
          event_type: kind === 'proposal' ? 'PROPOSAL_STATUS_CHANGED' : 'INVITATION_STATUS_CHANGED',
          project_id: projectId,
          [kind === 'proposal' ? 'proposal_id' : 'invitation_id']: sourceId,
          message: 'Предложение закрыто: условия проекта изменились или проект отменён',
          metadata: { status, reason },
        },
      });
    },

    // метод проверки наличия активного или завершённого заказа по проекту
    async blockingOrder(id) {
      return Boolean(
        await database.orders.findFirst({
          where: { project_id: id, status: { in: blockingStatuses } },
          select: { id: true },
        }),
      );
    },

    // метод проверки наличия откликов, приглашений или заказов в истории проекта
    async hasHistory(id) {
      return (
        (await database.proposals.count({ where: { project_id: id } })) > 0 ||
        (await database.project_invitations.count({ where: { project_id: id } })) > 0 ||
        (await database.orders.count({ where: { project_id: id } })) > 0
      );
    },

    // метод удаления записи проекта из базы
    async remove(id) {
      await database.projects.deleteMany({ where: { id } });
    },
  };
}
