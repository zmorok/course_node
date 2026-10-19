import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { createUploadMiddleware } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/app-error.js';
import { fileParams, avatarInput } from '../validators/files.js';
import { createFileController } from '../controllers/file.controller.js';

export function createFileRouter(service, authService) {
  const router = Router(), controller = createFileController(service), authenticated = authMiddleware(authService);
  const writes = rateLimit({ windowMs: 15*60*1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req,_res,next) => next(new AppError(429,'RATE_LIMITED','Слишком много изменений. Повторите позже')) });
  router.get('/files/:fileId', validate(fileParams,'params'), (request,response,next) =>
    request.get('authorization') ? authenticated(request,response,next) : next(), asyncHandler(controller.download));
  router.get('/files', authenticated, roleMiddleware('CLIENT'), asyncHandler(controller.listOwn));
  router.post('/files', authenticated, roleMiddleware('CLIENT'), writes, createUploadMiddleware(), asyncHandler(controller.upload));
  router.delete('/files/:fileId', authenticated, roleMiddleware('CLIENT'), writes, validate(fileParams,'params'), asyncHandler(controller.remove));
  router.get('/me/avatar', authenticated, roleMiddleware('CLIENT'), asyncHandler(controller.getAvatar));
  router.put('/me/avatar', authenticated, roleMiddleware('CLIENT'), writes, validate(avatarInput), asyncHandler(controller.setAvatar));
  router.delete('/me/avatar', authenticated, roleMiddleware('CLIENT'), writes, asyncHandler(controller.removeAvatar));
  return router;
}
