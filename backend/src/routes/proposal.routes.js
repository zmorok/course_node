import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/app-error.js';
import { projectParams, emptyCommand } from '../validators/projects.js';
import {
  proposalCreate,
  proposalParams,
  proposalReject,
  projectProposalQuery,
  ownProposalQuery,
} from '../validators/proposals.js';
import { createProposalController } from '../controllers/proposal.controller.js';

export function createProposalRouter(service, authService) {
  const router = Router();
  const controller = createProposalController(service);
  const clientMiddleware = [authMiddleware(authService), roleMiddleware('CLIENT')];

  const writeRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) =>
      next(
        new AppError(429, 'RATE_LIMITED', 'Слишком много действий с откликами. Повторите позже'),
      ),
  });

  router.get(
    '/me/proposals',
    ...clientMiddleware,
    validate(ownProposalQuery, 'query'),
    asyncHandler(controller.own),
  );

  router.get(
    '/projects/:projectId/proposals',
    ...clientMiddleware,
    validate(projectParams, 'params'),
    validate(projectProposalQuery, 'query'),
    asyncHandler(controller.project),
  );

  router.post(
    '/projects/:projectId/proposals',
    ...clientMiddleware,
    writeRateLimit,
    validate(projectParams, 'params'),
    validate(proposalCreate),
    asyncHandler(controller.create),
  );

  router.get(
    '/proposals/:proposalId',
    ...clientMiddleware,
    validate(proposalParams, 'params'),
    asyncHandler(controller.get),
  );

  router.post(
    '/proposals/:proposalId/withdraw',
    ...clientMiddleware,
    writeRateLimit,
    validate(proposalParams, 'params'),
    validate(emptyCommand),
    asyncHandler(controller.withdraw),
  );

  router.post(
    '/proposals/:proposalId/reject',
    ...clientMiddleware,
    writeRateLimit,
    validate(proposalParams, 'params'),
    validate(proposalReject),
    asyncHandler(controller.reject),
  );

  router.post(
    '/proposals/:proposalId/accept',
    ...clientMiddleware,
    writeRateLimit,
    validate(proposalParams, 'params'),
    validate(emptyCommand),
    asyncHandler(controller.accept),
  );

  return router;
}
