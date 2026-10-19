import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/app-error.js';
import { portfolioInput,portfolioParams,portfolioUserParams } from '../validators/portfolio.js';
import { createPortfolioController } from '../controllers/portfolio.controller.js';
export function createPortfolioRouter(service,authService) {
  const router = Router(), controller = createPortfolioController(service);
  const writes = rateLimit({ windowMs:15*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,
    handler:(_req,_res,next) => next(new AppError(429,'RATE_LIMITED','Слишком много изменений. Повторите позже')) });
  router.get('/users/:userId/portfolio',validate(portfolioUserParams,'params'),asyncHandler(controller.listPublic));
  router.use('/me/portfolio',authMiddleware(authService),roleMiddleware('CLIENT'));
  router.get('/me/portfolio',asyncHandler(controller.listOwn));
  router.get('/me/portfolio/:itemId',validate(portfolioParams,'params'),asyncHandler(controller.getOwn));
  router.post('/me/portfolio',writes,validate(portfolioInput),asyncHandler(controller.create));
  router.put('/me/portfolio/:itemId',writes,validate(portfolioParams,'params'),validate(portfolioInput),asyncHandler(controller.update));
  router.delete('/me/portfolio/:itemId',writes,validate(portfolioParams,'params'),asyncHandler(controller.remove));
  return router;
}
