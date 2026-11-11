import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';

import { createHealthController } from '../controllers/health.controller.js';

export function createHealthRouter(healthService) {
  const router = Router();

  router.get('/health', asyncHandler(createHealthController(healthService)));

  return router;
}
