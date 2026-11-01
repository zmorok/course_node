import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/app-error.js';
import { createProjectController } from '../controllers/project.controller.js';
import {
  projectParams,
  projectFileParams,
  projectFileInput,
  projectCreate,
  projectPatch,
  projectCancel,
  projectQuery,
  ownProjectQuery,
  emptyCommand,
} from '../validators/projects.js';

export function createProjectRouter(service, authService) {
  const router = Router();
  const controller = createProjectController(service);
  const authenticate = authMiddleware(authService);
  const optionalAuth = (request, response, next) =>
    request.get('authorization') ? authenticate(request, response, next) : next();

  const writeRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Слишком много изменений. Повторите позже')),
  });

  const client = [authenticate, roleMiddleware('CLIENT'), writeRateLimit];

  router.get('/categories', asyncHandler(controller.categories));

  router.get(
    '/projects',
    optionalAuth,
    validate(projectQuery, 'query'),
    asyncHandler(controller.catalog),
  );

  router.get(
    '/me/projects',
    authenticate,
    roleMiddleware('CLIENT'),
    validate(ownProjectQuery, 'query'),
    asyncHandler(controller.own),
  );

  router.get(
    '/projects/:projectId',
    optionalAuth,
    validate(projectParams, 'params'),
    asyncHandler(controller.get),
  );

  router.post('/projects', ...client, validate(projectCreate), asyncHandler(controller.create));

  router.patch(
    '/projects/:projectId',
    ...client,
    validate(projectParams, 'params'),
    validate(projectPatch),
    asyncHandler(controller.patch),
  );

  router.delete(
    '/projects/:projectId',
    ...client,
    validate(projectParams, 'params'),
    asyncHandler(controller.remove),
  );

  router.post(
    '/projects/:projectId/publish',
    ...client,
    validate(projectParams, 'params'),
    validate(emptyCommand),
    asyncHandler(controller.publish),
  );

  router.post(
    '/projects/:projectId/cancel',
    ...client,
    validate(projectParams, 'params'),
    validate(projectCancel),
    asyncHandler(controller.cancel),
  );

  router.post(
    '/projects/:projectId/files',
    ...client,
    validate(projectParams, 'params'),
    validate(projectFileInput),
    asyncHandler(controller.attachFile),
  );

  router.delete(
    '/projects/:projectId/files/:fileId',
    ...client,
    validate(projectFileParams, 'params'),
    asyncHandler(controller.detachFile),
  );

  return router;
}
