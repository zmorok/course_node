import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';
import { createRateLimit } from '../utils/rate-limit.js';

import { fileParams, avatarInput } from '../validators/files.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { createUploadMiddleware } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';

import { createFileController } from '../controllers/file.controller.js';

export function createFileRouter(service, authService) {
  const router = Router();
  const controller = createFileController(service);
  const authenticated = authMiddleware(authService);

  const writeRateLimit = createRateLimit(15, 60);

  router.get(
    '/files/:fileId',
    validate(fileParams, 'params'),
    (request, response, next) =>
      request.get('authorization') ? authenticated(request, response, next) : next(),
    asyncHandler(controller.download),
  );

  router.get('/files', authenticated, roleMiddleware('CLIENT'), asyncHandler(controller.listOwn));

  router.post(
    '/files',
    authenticated,
    roleMiddleware('CLIENT'),
    writeRateLimit,
    createUploadMiddleware(),
    asyncHandler(controller.upload),
  );

  router.delete(
    '/files/:fileId',
    authenticated,
    roleMiddleware('CLIENT'),
    writeRateLimit,
    validate(fileParams, 'params'),
    asyncHandler(controller.remove),
  );

  router.get(
    '/me/avatar',
    authenticated,
    roleMiddleware('CLIENT'),
    asyncHandler(controller.getAvatar),
  );

  router.put(
    '/me/avatar',
    authenticated,
    roleMiddleware('CLIENT'),
    writeRateLimit,
    validate(avatarInput),
    asyncHandler(controller.setAvatar),
  );

  router.delete(
    '/me/avatar',
    authenticated,
    roleMiddleware('CLIENT'),
    writeRateLimit,
    asyncHandler(controller.removeAvatar),
  );

  return router;
}
