import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/app-error.js';
import { profilePatch, profileParams, userSkillsInput, passwordChange } from '../validators/profile.js';
import { createProfileController } from '../controllers/profile.controller.js';

export function createProfileRouter(service, authService) {
  const router = Router(), controller = createProfileController(service);
  const authenticated = authMiddleware(authService);
  const writes = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_request, _response, next) => next(new AppError(429, 'RATE_LIMITED', 'Слишком много изменений. Повторите позже')) });
  router.get('/skills', asyncHandler(controller.listSkills));
  router.get('/users/:userId', validate(profileParams, 'params'), asyncHandler(controller.getPublic));
  router.get('/me/profile', authenticated, asyncHandler(controller.getOwn));
  router.patch('/me/profile', authenticated, writes, validate(profilePatch), asyncHandler(controller.updateOwn));
  router.put('/me/skills', authenticated, roleMiddleware('CLIENT'), writes, validate(userSkillsInput), asyncHandler(controller.replaceSkills));
  router.post('/me/password', authenticated, writes, validate(passwordChange), asyncHandler(controller.changePassword));
  return router;
}
