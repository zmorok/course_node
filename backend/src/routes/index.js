import { Router } from 'express';
import { createHealthRouter } from './health.routes.js';
import { createAuthRouter } from './auth.routes.js';

export function createApiRouter({ healthService, authService, authConfig }) {
  const router = Router();
  router.use(createHealthRouter(healthService));
  if (authService) router.use(createAuthRouter(authService, authConfig));
  return router;
}
