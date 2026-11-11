import { AppError, ValidationError } from '../utils/app-error.js';
import { requireFileActor } from './file.service.js';

const missing = () => new AppError(404, 'PROJECT_NOT_FOUND', 'Проект не найден');
const conflict = () =>
  new AppError(409, 'PROJECT_STATE_CONFLICT', 'Действие недоступно в текущем состоянии проекта');
const haveSameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
const iso = (value) => (value ? new Date(value).toISOString() : null);

function toProjectDto(row, actor) {
  const own = row.customer_id === actor?.id;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    category: row.category_id
      ? { id: row.category_id, slug: row.category_slug, name: row.category_name }
      : null,
    budget: row.budget,
    desiredDeadlineAt: row.desired_deadline_at,
    skills: row.skills,
    files: row.files,
    customer: {
      id: row.customer_id,
      username: row.username,
      firstName: row.first_name,
      lastName: row.last_name,
    },
    isOwn: own,
    acceptsProposals: row.status === 'OPEN' && row.customer_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    ...(own
      ? {
          cancelledAt: row.cancelled_at,
          cancellationReason: row.cancellation_reason,
          completedAt: row.completed_at,
        }
      : {}),
  };
}

// проверка того, что заданный желаемый срок ещё не истёк
function requireFutureDeadline(value) {
  if (value && new Date(value).getTime() <= Date.now()) {
    throw new ValidationError([
      { field: 'body.desiredDeadlineAt', message: 'Желаемый срок должен быть в будущем' },
    ]);
  }
}

export function createProjectService({ repository, transaction, fileService }) {
  // закрытие ожидающих откликов и приглашений с аудитом и уведомлениями
  async function closePendingProposalsAndInvitations(transactionRepository, id, reason, actorId) {
    const closed = await transactionRepository.closePending(id, reason);

    for (const [kind, rows, status] of [
      ['proposal', closed.proposals, 'REJECTED'],
      ['invitation', closed.invitations, 'EXPIRED'],
    ]) {
      for (const row of rows) {
        await transactionRepository.audit(
          actorId,
          `${kind.toUpperCase()}_STATUS_CHANGED`,
          kind,
          row.id,
          { projectId: id, status, reason },
        );
        await transactionRepository.notifyClosed(
          row.freelancer_id,
          kind,
          row.id,
          id,
          status,
          reason,
        );
      }
    }
  }

  // проверка категории и навыков проекта по справочникам
  async function validateReferences(transactionRepository, input) {
    const valid = await transactionRepository.validReferences(input.categoryId, input.skillIds);
    const issues = [];

    if (!valid.category) {
      issues.push({ field: 'body.categoryId', message: 'Выберите категорию из справочника' });
    }

    if (!valid.skills) {
      issues.push({ field: 'body.skillIds', message: 'Выберите навыки из справочника' });
    }

    if (issues.length) {
      throw new ValidationError(issues);
    }
  }

  // проверка возможности изменить проект по статусу и отсутствию активного заказа
  async function requireMutableProject(transactionRepository, row) {
    if (
      !['DRAFT', 'OPEN'].includes(row.status) ||
      (await transactionRepository.blockingOrder(row.id))
    ) {
      throw conflict();
    }
  }

  // выполнение операции со своим проектом в транзакции с последующей очисткой файлов
  async function runOwnProjectOperation(actor, id, operation) {
    const result = await transaction(async (transactionRepository, fileRepository) => {
      requireFileActor(await fileRepository.lockActor(actor.id));

      const row = await transactionRepository.lockOwn(id, actor.id);

      if (!row) {
        throw missing();
      }

      return operation(transactionRepository, fileRepository, row);
    });

    await fileService.drainDeletes();

    return result;
  }

  // применение изменений проекта с проверкой условий, вложений и закрытием старых предложений
  async function applyProjectPatch(transactionRepository, fileRepository, row, actor, patch) {
    await requireMutableProject(transactionRepository, row);

    const beforeSkills = await transactionRepository.skills(row.id);
    const beforeFiles = await transactionRepository.files(row.id);

    const before = {
      title: row.title,
      description: row.description,
      categoryId: row.category_id,
      budget: row.budget,
      desiredDeadlineAt: iso(row.desired_deadline_at),
      skillIds: beforeSkills,
      fileIds: beforeFiles,
    };

    const next = { ...before, ...patch };

    if (
      Object.hasOwn(patch, 'desiredDeadlineAt') &&
      next.desiredDeadlineAt !== before.desiredDeadlineAt
    ) {
      requireFutureDeadline(next.desiredDeadlineAt);
    }

    if (row.status === 'OPEN' && (!next.categoryId || !next.description.trim())) {
      throw new ValidationError([
        { field: 'body', message: 'У опубликованного проекта должны быть категория и описание' },
      ]);
    }

    await validateReferences(transactionRepository, next);
    await fileService.attachable(fileRepository, actor.id, next.fileIds, beforeFiles);

    const changed =
      ['title', 'description', 'categoryId', 'budget', 'desiredDeadlineAt'].some(
        (key) => before[key] !== next[key],
      ) ||
      !haveSameIds(beforeSkills, next.skillIds) ||
      !haveSameIds(beforeFiles, next.fileIds);

    if (changed) {
      if (row.status === 'OPEN') {
        await closePendingProposalsAndInvitations(
          transactionRepository,
          row.id,
          'TERMS_CHANGED',
          actor.id,
        );
      }

      await transactionRepository.update(row.id, next);
      await transactionRepository.replaceSkills(row.id, next.skillIds);
      await transactionRepository.replaceFiles(row.id, next.fileIds);
      await fileRepository.markUnusedDeleted(
        beforeFiles.filter((id) => !next.fileIds.includes(id)),
      );

      const fields = Object.keys(before).filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(next[key]),
      );

      await transactionRepository.audit(
        actor.id,
        'PROJECT_UPDATED',
        'project',
        row.id,
        { fields },
        {
          oldData: Object.fromEntries(fields.map((key) => [key, before[key]])),
          newData: Object.fromEntries(fields.map((key) => [key, next[key]])),
        },
      );
    }

    return toProjectDto(await transactionRepository.findVisible(row.id, actor.id), actor);
  }

  return {
    // метод получения справочника категорий проектов
    async categories() {
      return repository.categories();
    },

    // метод получения доступных или собственных проектов по фильтрам
    async list(query, actor, mine = false) {
      if (mine) {
        requireFileActor(actor);
      }

      const result = await repository.list(query, mine ? actor.id : undefined);

      return {
        items: result.items.map((row) => toProjectDto(row, actor)),
        total: result.total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    // метод получения одного проекта с проверкой его видимости для пользователя
    async get(id, actor) {
      const row = await repository.findVisible(id, actor?.id);

      if (!row) {
        throw missing();
      }

      return toProjectDto(row, actor);
    },

    // метод создания черновика проекта с проверкой лимита, справочников и вложений
    async create(actor, input) {
      return transaction(async (transactionRepository, fileRepository) => {
        requireFileActor(await fileRepository.lockActor(actor.id));
        requireFutureDeadline(input.desiredDeadlineAt);

        if ((await transactionRepository.countOwn(actor.id)) >= 100) {
          throw new AppError(409, 'PROJECT_QUOTA', 'Можно создать не более 100 проектов');
        }

        await validateReferences(transactionRepository, input);
        await fileService.attachable(fileRepository, actor.id, input.fileIds);

        const id = await transactionRepository.insert(actor.id, input);

        await transactionRepository.replaceSkills(id, input.skillIds);
        await transactionRepository.replaceFiles(id, input.fileIds);
        await transactionRepository.audit(
          actor.id,
          'PROJECT_CREATED',
          'project',
          id,
          { status: 'DRAFT' },
          { newData: { title: input.title, budget: input.budget, status: 'DRAFT' } },
        );

        return toProjectDto(await transactionRepository.findVisible(id, actor.id), actor);
      });
    },

    // метод частичного изменения собственного проекта
    async patch(actor, id, input) {
      return runOwnProjectOperation(actor, id, (transactionRepository, fileRepository, row) =>
        applyProjectPatch(transactionRepository, fileRepository, row, actor, input),
      );
    },

    // метод публикации своего черновика после проверки обязательных данных и срока
    async publish(actor, id) {
      return runOwnProjectOperation(
        actor,
        id,
        async (transactionRepository, _fileRepository, row) => {
          if (row.status !== 'DRAFT') {
            throw conflict();
          }

          await requireMutableProject(transactionRepository, row);

          if (!row.description.trim() || !row.category_id) {
            throw new ValidationError([
              { field: 'body', message: 'Для публикации заполните описание и категорию' },
            ]);
          }

          requireFutureDeadline(row.desired_deadline_at);
          await transactionRepository.publish(id);
          await transactionRepository.audit(
            actor.id,
            'PROJECT_PUBLISHED',
            'project',
            id,
            {},
            { oldData: { status: 'DRAFT' }, newData: { status: 'OPEN' } },
          );

          return toProjectDto(await transactionRepository.findVisible(id, actor.id), actor);
        },
      );
    },

    // метод отмены своего проекта с закрытием ожидающих откликов и приглашений
    async cancel(actor, id, reason) {
      return runOwnProjectOperation(
        actor,
        id,
        async (transactionRepository, _fileRepository, row) => {
          await requireMutableProject(transactionRepository, row);
          await closePendingProposalsAndInvitations(
            transactionRepository,
            id,
            'PROJECT_CANCELLED',
            actor.id,
          );
          await transactionRepository.cancel(id, reason);
          await transactionRepository.audit(
            actor.id,
            'PROJECT_CANCELLED',
            'project',
            id,
            { reason },
            { oldData: { status: row.status }, newData: { status: 'CANCELLED' } },
          );

          return toProjectDto(await transactionRepository.findVisible(id, actor.id), actor);
        },
      );
    },

    // метод удаления собственного черновика без истории с очисткой неиспользуемых файлов
    async remove(actor, id) {
      return runOwnProjectOperation(
        actor,
        id,
        async (transactionRepository, fileRepository, row) => {
          if (row.status !== 'DRAFT' || (await transactionRepository.hasHistory(id))) {
            throw conflict();
          }

          const ids = await transactionRepository.files(id);

          await transactionRepository.remove(id);
          await fileRepository.markUnusedDeleted(ids);
          await transactionRepository.audit(
            actor.id,
            'PROJECT_REMOVED',
            'project',
            id,
            {},
            { oldData: { title: row.title, status: row.status } },
          );
        },
      );
    },

    // метод прикрепления файла к своему проекту с проверкой лимита вложений
    async attachFile(actor, id, fileId) {
      return runOwnProjectOperation(
        actor,
        id,
        async (transactionRepository, fileRepository, row) => {
          const ids = await transactionRepository.files(id);

          if (ids.includes(fileId)) {
            throw new AppError(409, 'FILE_IN_USE', 'Файл уже прикреплён к проекту');
          }

          if (ids.length >= 8) {
            throw new AppError(422, 'PROJECT_FILE_LIMIT', 'Можно прикрепить не более 8 файлов');
          }

          return applyProjectPatch(transactionRepository, fileRepository, row, actor, {
            fileIds: [...ids, fileId],
          });
        },
      );
    },

    // метод открепления файла от своего проекта с применением общих проверок изменения
    async detachFile(actor, id, fileId) {
      return runOwnProjectOperation(
        actor,
        id,
        async (transactionRepository, fileRepository, row) => {
          const ids = await transactionRepository.files(id);

          if (!ids.includes(fileId)) {
            throw missing();
          }

          return applyProjectPatch(transactionRepository, fileRepository, row, actor, {
            fileIds: ids.filter((value) => value !== fileId),
          });
        },
      );
    },
  };
}
