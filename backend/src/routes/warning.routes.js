import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';
import { createRateLimit } from '../utils/rate-limit.js';

import { orderDetailQuery } from '../validators/orders.js';
import { profileParams } from '../validators/profile.js';
import { warningInput, warningQuery } from '../validators/warnings.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createWarningController } from '../controllers/warning.controller.js';

export function createWarningRouter(service, authService) {
  const router = Router();
  const controller = createWarningController(service);
  const authenticate = authMiddleware(authService);

  router.get(
    '/me/warnings',
    authenticate,
    roleMiddleware('CLIENT'),
    validate(warningQuery, 'query'),
    asyncHandler(controller.list),
  );

  const writeRateLimit = createRateLimit(15, 60);

  router.post(
    '/admin/users/:userId/warnings',
    authenticate,
    roleMiddleware('ADMIN'),
    writeRateLimit,
    validate(profileParams, 'params'),
    validate(orderDetailQuery, 'query'),
    validate(warningInput),
    asyncHandler(controller.issue),
  );

  return router;
}
