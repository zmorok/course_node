import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import { orderParams, orderDetailQuery } from '../validators/orders.js';
import { profileParams } from '../validators/profile.js';
import { emptyCommand } from '../validators/projects.js';
import {
  reviewInput,
  reviewParams,
  ownReviewQuery,
  publicReviewQuery,
} from '../validators/reviews.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createReviewController } from '../controllers/review.controller.js';

export function createReviewRouter(service, authService) {
  const router = Router();
  const controller = createReviewController(service);
  const clientMiddleware = [authMiddleware(authService), roleMiddleware('CLIENT')];

  const writeRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Слишком много изменений отзывов. Повторите позже')),
  });

  router.get(
    '/users/:userId/reviews',
    validate(profileParams, 'params'),
    validate(publicReviewQuery, 'query'),
    asyncHandler(controller.public),
  );

  router.get(
    '/me/reviews',
    ...clientMiddleware,
    validate(ownReviewQuery, 'query'),
    asyncHandler(controller.own),
  );

  router.get(
    '/orders/:orderId/reviews',
    ...clientMiddleware,
    validate(orderParams, 'params'),
    validate(orderDetailQuery, 'query'),
    asyncHandler(controller.order),
  );

  router.post(
    '/orders/:orderId/reviews',
    ...clientMiddleware,
    writeRateLimit,
    validate(orderParams, 'params'),
    validate(orderDetailQuery, 'query'),
    validate(reviewInput),
    asyncHandler(controller.create),
  );

  router.put(
    '/reviews/:reviewId',
    ...clientMiddleware,
    writeRateLimit,
    validate(reviewParams, 'params'),
    validate(orderDetailQuery, 'query'),
    validate(reviewInput),
    asyncHandler(controller.update),
  );

  router.delete(
    '/reviews/:reviewId',
    ...clientMiddleware,
    writeRateLimit,
    validate(reviewParams, 'params'),
    validate(orderDetailQuery, 'query'),
    validate(emptyCommand),
    asyncHandler(controller.hide),
  );

  router.post(
    '/reviews/:reviewId/restore',
    ...clientMiddleware,
    writeRateLimit,
    validate(reviewParams, 'params'),
    validate(orderDetailQuery, 'query'),
    validate(emptyCommand),
    asyncHandler(controller.restore),
  );

  return router;
}
