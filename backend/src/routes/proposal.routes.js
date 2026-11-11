import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';
import { createRateLimit } from '../utils/rate-limit.js';

import { projectParams, emptyCommand } from '../validators/projects.js';
import {
  proposalCreate,
  proposalParams,
  proposalReject,
  projectProposalQuery,
  ownProposalQuery,
} from '../validators/proposals.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createProposalController } from '../controllers/proposal.controller.js';

export function createProposalRouter(service, authService) {
  const router = Router();
  const controller = createProposalController(service);
  const clientMiddleware = [authMiddleware(authService), roleMiddleware('CLIENT')];

  const writeRateLimit = createRateLimit(15, 60);

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
