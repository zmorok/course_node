import { Router } from 'express';
import { createHealthRouter } from './health.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createProfileRouter } from './profile.routes.js';

export function createApiRouter({ healthService, authService, authConfig, profileService }) {
  const router = Router();
  router.use(createHealthRouter(healthService));
  if (authService) router.use(createAuthRouter(authService, authConfig));
  if (profileService) router.use(createProfileRouter(profileService, authService));
  return router;
}
