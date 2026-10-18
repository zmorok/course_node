import { Router } from 'express';
import { createHealthController } from '../controllers/health.controller.js';
import { asyncHandler } from '../utils/async-handler.js';

export function createHealthRouter(healthService) {
  const router = Router();
  router.get('/health', asyncHandler(createHealthController(healthService)));
  return router;
}
