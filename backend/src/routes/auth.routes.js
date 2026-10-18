import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createAuthController } from '../controllers/auth.controller.js';
import { authMiddleware, roleMiddleware, authCsrf } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { registerInput, loginInput } from '../validators/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/app-error.js';

export function createAuthRouter(service, config) {
  const router = Router();
  const controller = createAuthController(service, config);
  const limiter = limit => rateLimit({ windowMs: 15 * 60 * 1000, limit,
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Слишком много попыток. Повторите позже')) });
  const credentialsLimit = limiter(20);
  const sessionLimit = limiter(120);
  router.post('/auth/register', authCsrf, credentialsLimit, validate(registerInput), asyncHandler(controller.register));
  router.post('/auth/login', authCsrf, credentialsLimit, validate(loginInput), asyncHandler(controller.login));
  router.post('/auth/refresh', authCsrf, sessionLimit, asyncHandler(controller.refresh));
  router.post('/auth/logout', authCsrf, sessionLimit, asyncHandler(controller.logout));
  router.get('/auth/me', authMiddleware(service), controller.me);
  router.get('/admin/access', authMiddleware(service), roleMiddleware('ADMIN'), controller.adminAccess);
  return router;
}
