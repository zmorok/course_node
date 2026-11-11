import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';
import { createRateLimit } from '../utils/rate-limit.js';

import { auditQuery } from '../validators/audit.js';

import { auditUpload } from '../middleware/audit-upload.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createAuditController } from '../controllers/audit.controller.js';

export function createAuditRouter(service, authService) {
  const router = Router();
  const controller = createAuditController(service);

  const writeRateLimit = createRateLimit(15, 20);

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
