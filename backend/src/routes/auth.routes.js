import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';
import { createRateLimit } from '../utils/rate-limit.js';

import { registerInput, loginInput } from '../validators/auth.js';

import { authMiddleware, roleMiddleware, authCsrf } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createAuthController } from '../controllers/auth.controller.js';

export function createAuthRouter(service, config) {
  const router = Router();
  const controller = createAuthController(service, config);

  const credentialsLimit = createRateLimit(15, 20);
  const sessionLimit = createRateLimit(15, 120);

  router.post(
    '/auth/register',
    authCsrf,
    credentialsLimit,
    validate(registerInput),
    asyncHandler(controller.register),
  );

  router.post(
    '/auth/login',
    authCsrf,
    credentialsLimit,
    validate(loginInput),
    asyncHandler(controller.login),
  );

  router.post('/auth/refresh', authCsrf, sessionLimit, asyncHandler(controller.refresh));

  router.post('/auth/logout', authCsrf, sessionLimit, asyncHandler(controller.logout));

  router.get('/auth/me', authMiddleware(service), controller.me);

  router.get(
    '/admin/access',
    authMiddleware(service),
    roleMiddleware('ADMIN'),
    controller.adminAccess,
  );

  return router;
}
