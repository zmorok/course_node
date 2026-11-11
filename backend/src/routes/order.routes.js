import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import {
  submissionCreate,
  submissionRevision,
  submissionAccept,
  deadlineCreate,
  deadlineReject,
  deadlineApprove,
  submissionParams,
  deadlineParams,
  workQuery,
  orderCancel,
} from '../validators/order-work.js';
import { orderQuery, orderParams, orderDetailQuery } from '../validators/orders.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createOrderWorkController } from '../controllers/order-work.controller.js';
import { createOrderController } from '../controllers/order.controller.js';

export function createOrderRouter(service, authService, workService) {
  const router = Router();
  const controller = createOrderController(service);
  const clientMiddleware = [authMiddleware(authService), roleMiddleware('CLIENT')];

  router.get(
    '/me/orders',
    ...clientMiddleware,
    validate(orderQuery, 'query'),
    asyncHandler(controller.own),
  );

  router.get(
    '/orders/:orderId',
    ...clientMiddleware,
    validate(orderParams, 'params'),
    validate(orderDetailQuery, 'query'),
    asyncHandler(controller.get),
  );

  if (workService) {
    const workController = createOrderWorkController(workService);

    const writeRateLimit = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 60,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_request, _response, next) =>
        next(
          new AppError(429, 'RATE_LIMITED', 'Слишком много действий с заказами. Повторите позже'),
        ),
    });

    for (const [suffix, handler] of [
      ['submissions', workController.submissions],
      ['deadline-requests', workController.deadlines],
      ['events', workController.events],
    ]) {
      router.get(
        `/orders/:orderId/${suffix}`,
        ...clientMiddleware,
        validate(orderParams, 'params'),
        validate(workQuery, 'query'),
        asyncHandler(handler),
      );
    }

    router.post(
      '/orders/:orderId/cancel',
      ...clientMiddleware,
      writeRateLimit,
      validate(orderParams, 'params'),
      validate(orderDetailQuery, 'query'),
      validate(orderCancel),
      asyncHandler(workController.cancel),
    );

    const commandRoutes = [
      ['submissions', orderParams, submissionCreate, workController.submit],
      [
        'submissions/:submissionId/revision',
        submissionParams,
        submissionRevision,
        workController.revision,
      ],
      [
        'submissions/:submissionId/accept',
        submissionParams,
        submissionAccept,
        workController.accept,
      ],
      ['deadline-requests', orderParams, deadlineCreate, workController.requestDeadline],
      [
        'deadline-requests/:requestId/approve',
        deadlineParams,
        deadlineApprove,
        workController.approve,
      ],
      [
        'deadline-requests/:requestId/reject',
        deadlineParams,
        deadlineReject,
        workController.reject,
      ],
    ];

    for (const [suffix, parseParams, parseBody, handler] of commandRoutes) {
      router.post(
        `/orders/:orderId/${suffix}`,
        ...clientMiddleware,
        writeRateLimit,
        validate(parseParams, 'params'),
        validate(orderDetailQuery, 'query'),
        validate(parseBody),
        asyncHandler(handler),
      );
    }
  }

  return router;
}
