import { Router } from 'express';
import { createHealthRouter } from './health.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createProfileRouter } from './profile.routes.js';
import { createFileRouter } from './file.routes.js';
import { createPortfolioRouter } from './portfolio.routes.js';

export function createApiRouter({ healthService, authService, authConfig, profileService, fileService, portfolioService }) {
  const router = Router();
  router.use(createHealthRouter(healthService));
  if (authService) router.use(createAuthRouter(authService, authConfig));
  if (profileService) router.use(createProfileRouter(profileService, authService));
  if (fileService) router.use(createFileRouter(fileService, authService));
  if (portfolioService) router.use(createPortfolioRouter(portfolioService, authService));
  return router;
}
