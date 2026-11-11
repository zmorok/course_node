import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';
import { createRateLimit } from '../utils/rate-limit.js';

import {
  invitationCreate,
  invitationDecline,
  invitationParams,
  projectInvitationQuery,
  ownInvitationQuery,
} from '../validators/invitations.js';
import { profileParams } from '../validators/profile.js';
import { projectParams, emptyCommand } from '../validators/projects.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createInvitationController } from '../controllers/invitation.controller.js';

export function createInvitationRouter(service, authService) {
  const router = Router();
  const controller = createInvitationController(service);
  const clientMiddleware = [authMiddleware(authService), roleMiddleware('CLIENT')];

  const writeRateLimit = createRateLimit(15, 60);

  router.get(
    '/freelancers/:userId/projects',
    ...clientMiddleware,
    validate(profileParams, 'params'),
    asyncHandler(controller.projects),
  );

  router.get(
    '/me/invitations',
    ...clientMiddleware,
    validate(ownInvitationQuery, 'query'),
    asyncHandler(controller.own),
  );

  router.get(
    '/projects/:projectId/invitations',
    ...clientMiddleware,
    validate(projectParams, 'params'),
    validate(projectInvitationQuery, 'query'),
    asyncHandler(controller.project),
  );

  router.post(
    '/projects/:projectId/invitations',
    ...clientMiddleware,
    writeRateLimit,
    validate(projectParams, 'params'),
    validate(invitationCreate),
    asyncHandler(controller.create),
  );

  router.get(
    '/invitations/:invitationId',
    ...clientMiddleware,
    validate(invitationParams, 'params'),
    asyncHandler(controller.get),
  );

  router.post(
    '/invitations/:invitationId/accept',
    ...clientMiddleware,
    writeRateLimit,
    validate(invitationParams, 'params'),
    validate(emptyCommand),
    asyncHandler(controller.accept),
  );

  router.post(
    '/invitations/:invitationId/decline',
    ...clientMiddleware,
    writeRateLimit,
    validate(invitationParams, 'params'),
    validate(invitationDecline),
    asyncHandler(controller.decline),
  );

  return router;
}
