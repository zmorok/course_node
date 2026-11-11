import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import { auditQuery } from '../validators/audit.js';

import { auditUpload } from '../middleware/audit-upload.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createAuditController } from '../controllers/audit.controller.js';

export function createAuditRouter(service, authService) {
  const router = Router();
  const controller = createAuditController(service);

  const writeRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Слишком много изменений. Повторите позже')),
  });

  router.get(
    '/admin/audit/export',
    authMiddleware(authService),
    roleMiddleware('ADMIN'),
    validate(auditQuery, 'query'),
    asyncHandler(controller.export),
  );

  router.get(
    '/admin/audit/imported',
    authMiddleware(authService),
    roleMiddleware('ADMIN'),
    validate(auditQuery, 'query'),
    asyncHandler(controller.imported),
  );

  router.post(
    '/admin/audit/import',
    authMiddleware(authService),
    roleMiddleware('ADMIN'),
    writeRateLimit,
    auditUpload,
    asyncHandler(controller.import),
  );

  router.get(
    '/admin/audit',
    authMiddleware(authService),
    roleMiddleware('ADMIN'),
    validate(auditQuery, 'query'),
    asyncHandler(controller.list),
  );

  return router;
}
