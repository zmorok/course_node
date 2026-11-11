import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';
import { createRateLimit } from '../utils/rate-limit.js';

import {
  profilePatch,
  profileParams,
  userSkillsInput,
  passwordChange,
} from '../validators/profile.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createProfileController } from '../controllers/profile.controller.js';

export function createProfileRouter(service, authService) {
  const router = Router();
  const controller = createProfileController(service);
  const authenticated = authMiddleware(authService);

  const writeRateLimit = createRateLimit(15, 30);

  router.get('/skills', asyncHandler(controller.listSkills));

  router.get(
    '/users/:userId',
    validate(profileParams, 'params'),
    asyncHandler(controller.getPublic),
  );

  router.get('/me/profile', authenticated, asyncHandler(controller.getOwn));

  router.patch(
    '/me/profile',
    authenticated,
    writeRateLimit,
    validate(profilePatch),
    asyncHandler(controller.updateOwn),
  );

  router.put(
    '/me/skills',
    authenticated,
    roleMiddleware('CLIENT'),
    writeRateLimit,
    validate(userSkillsInput),
    asyncHandler(controller.replaceSkills),
  );

  router.post(
    '/me/password',
    authenticated,
    writeRateLimit,
    validate(passwordChange),
    asyncHandler(controller.changePassword),
  );

  return router;
}
