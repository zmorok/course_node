import { Router } from 'express';
import { createHealthRouter } from './health.routes.js';

export function createApiRouter({ healthService }) {
  const router = Router();
  router.use(createHealthRouter(healthService));
  return router;
}
