import { AppError, ValidationError } from '../utils/app-error.js';
import { requireFileActor } from './file.service.js';
import { recordProposalChange } from './proposal-events.js';
import { activeClient as active, sourceDto } from './source-dto.js';

const missing = () => new AppError(404, 'PROPOSAL_NOT_FOUND', 'Отклик не найден');
const conflict = () =>
  new AppError(409, 'PROPOSAL_STATE_CONFLICT', 'Отклик уже рассмотрен или отозван');

function toProposalDto(row, actor) {
  const expired = row.status === 'PENDING' && row.expired;

  return {
    ...sourceDto(row),
    canWithdraw: actor.id === row.freelancer_id && row.status === 'PENDING' && !expired,
    canDecide:
      actor.id === row.customer_id &&
      row.status === 'PENDING' &&
      !expired &&
      row.project_status === 'OPEN',
  };
}

export function createProposalService({ repository, transaction, assignmentService }) {
  async function expirePendingProposals(transactionRepository, projectId) {
    const rows = await transactionRepository.expire(projectId);

    for (const row of rows) {
      await recordProposalChange(transactionRepository, row, null, 'REJECTED', 'TERMS_EXPIRED');
    }

    return rows.map((row) => row.id);
  }

  async function runProposalTransaction(operation) {
    try {
      const result = await transaction(operation);

      if (result?.error) {
        throw result.error;
      }

      return result;
    } catch (error) {
      if (error.code === '23505') {
        throw new AppError(409, 'PROPOSAL_CONFLICT', 'Активный отклик или заказ уже существует');
      }

      throw error;
    }
  }

  async function decideProposal(actor, id, kind, reason) {
    const context = await repository.proposalContext(id);

    if (!context || context[kind === 'withdraw' ? 'freelancer_id' : 'customer_id'] !== actor.id) {
      throw missing();
    }

    return runProposalTransaction(async (transactionRepository, assignmentRepository) => {
      const users = await transactionRepository.lockUsers([
        context.customer_id,
        context.freelancer_id,
      ]);

      requireFileActor(users.find((user) => user.id === actor.id));

      const project = await transactionRepository.lockProject(context.project_id);
      const source = await transactionRepository.lockProposal(id);

      if (
        !project ||
        !source ||
        source.project_id !== project.id ||
        source.customer_id !== context.customer_id ||
        source.freelancer_id !== context.freelancer_id
      ) {
        throw missing();
      }

      if (source.status !== 'PENDING') {
        throw conflict();
      }

      if (kind !== 'withdraw' && project.status !== 'OPEN') {
        throw new AppError(409, 'PROJECT_NOT_OPEN', 'Проект уже не принимает отклики');
      }

      if (kind === 'accept' && !active(users.find((user) => user.id === source.freelancer_id))) {
        throw new AppError(
          409,
          'COUNTERPARTY_UNAVAILABLE',
          'Исполнитель сейчас недоступен для назначения',
        );
      }

      const expired = await expirePendingProposals(transactionRepository, project.id);

      if (expired.includes(id)) {
        return {
          error: new AppError(
            409,
            'PROPOSAL_EXPIRED',
            'Предложенный срок истёк. Нужен новый отклик',
          ),
        };
      }

      const current = await transactionRepository.lockProposal(id);

      if (kind === 'accept') {
        await assignmentService.acceptProposal({
          project,
          proposal: current,
          actor,
          proposals: transactionRepository,
          assignments: assignmentRepository,
        });
      } else {
        const status = kind === 'withdraw' ? 'WITHDRAWN' : 'REJECTED';
        const closure = kind === 'withdraw' ? 'AUTHOR_WITHDRAWN' : reason;

        await transactionRepository.decide(id, status, closure);
        await recordProposalChange(transactionRepository, current, actor.id, status, closure);
      }

      return toProposalDto(await transactionRepository.find(id, actor.id), actor);
    });
  }

  return {
    async create(actor, projectId, input) {
      const context = await repository.projectContext(projectId);

      if (!context) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Проект не найден');
      }

      if (context.customer_id === actor.id) {
        throw new AppError(403, 'SELF_PROPOSAL', 'Нельзя откликнуться на свой проект');
      }

      return runProposalTransaction(async (transactionRepository, assignmentRepository) => {
        const users = await transactionRepository.lockUsers([actor.id, context.customer_id]);

        requireFileActor(users.find((user) => user.id === actor.id));

        const project = await transactionRepository.lockProject(projectId);

        if (
          !project ||
          project.customer_id !== context.customer_id ||
          !active(users.find((user) => user.id === context.customer_id))
        ) {
          throw new AppError(404, 'PROJECT_NOT_FOUND', 'Проект не найден');
        }

        if (project.status === 'DRAFT') {
          throw new AppError(404, 'PROJECT_NOT_FOUND', 'Проект не найден');
        }

        if (project.status !== 'OPEN' || (await assignmentRepository.blockingOrder(project.id))) {
          throw new AppError(409, 'PROJECT_NOT_OPEN', 'Проект уже не принимает отклики');
        }

        if (new Date(input.offeredDeadlineAt).getTime() <= Date.now()) {
          throw new ValidationError([
            { field: 'body.offeredDeadlineAt', message: 'Предложите срок в будущем' },
          ]);
        }

        await expirePendingProposals(transactionRepository, project.id);

        if (await transactionRepository.pending(project.id, actor.id)) {
          return {
            error: new AppError(
              409,
              'DUPLICATE_PROPOSAL',
              'У вас уже есть ожидающий отклик на этот проект',
            ),
          };
        }

        const id = await transactionRepository.create(project, actor.id, input);

        await transactionRepository.audit(actor.id, 'PROPOSAL_CREATED', 'proposal', id, {
          projectId,
        });
        await transactionRepository.notify(
          project.customer_id,
          'PROPOSAL_CREATED',
          projectId,
          id,
          'Получен новый отклик на проект',
        );

        return toProposalDto(await transactionRepository.find(id, actor.id), actor);
      });
    },

    async get(actor, id) {
      requireFileActor(actor);

      const row = await repository.find(id, actor.id);

      if (!row) {
        throw missing();
      }

      return toProposalDto(row, actor);
    },

    async listOwn(actor, query) {
      requireFileActor(actor);

      const result = await repository.list(query, {
        freelancerId: actor.id,
        projectId: query.projectId,
      });

      return {
        ...result,
        items: result.items.map((row) => toProposalDto(row, actor)),
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    async listProject(actor, projectId, query) {
      requireFileActor(actor);

      const project = await repository.projectContext(projectId);

      if (!project || project.customer_id !== actor.id) {
        throw new AppError(404, 'PROJECT_NOT_FOUND', 'Проект не найден');
      }

      const result = await repository.list(query, { projectId });

      return {
        ...result,
        items: result.items.map((row) => toProposalDto(row, actor)),
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    withdraw: (actor, id) => decideProposal(actor, id, 'withdraw'),

    reject: (actor, id, reason) => decideProposal(actor, id, 'reject', reason),

    accept: (actor, id) => decideProposal(actor, id, 'accept'),
  };
}
