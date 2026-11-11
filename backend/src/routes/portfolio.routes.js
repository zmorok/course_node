import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';
import { createRateLimit } from '../utils/rate-limit.js';

import { portfolioInput, portfolioParams, portfolioUserParams } from '../validators/portfolio.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createPortfolioController } from '../controllers/portfolio.controller.js';

export function createPortfolioRouter(service, authService) {
  const router = Router();
  const controller = createPortfolioController(service);

  const writeRateLimit = createRateLimit(15, 60);

  router.get(
    '/users/:userId/portfolio',
    validate(portfolioUserParams, 'params'),
    asyncHandler(controller.listPublic),
  );

  router.use('/me/portfolio', authMiddleware(authService), roleMiddleware('CLIENT'));

  router.get('/me/portfolio', asyncHandler(controller.listOwn));

  router.get(
    '/me/portfolio/:itemId',
    validate(portfolioParams, 'params'),
    asyncHandler(controller.getOwn),
  );

  router.post(
    '/me/portfolio',
    writeRateLimit,
    validate(portfolioInput),
    asyncHandler(controller.create),
  );

  router.put(
    '/me/portfolio/:itemId',
    writeRateLimit,
    validate(portfolioParams, 'params'),
    validate(portfolioInput),
    asyncHandler(controller.update),
  );

  router.delete(
    '/me/portfolio/:itemId',
    writeRateLimit,
    validate(portfolioParams, 'params'),
    asyncHandler(controller.remove),
  );

  return router;
}
