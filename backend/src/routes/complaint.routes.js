import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/app-error.js';
import { orderParams, orderDetailQuery } from '../validators/orders.js';
import { complaintInput, complaintParams, complaintQuery } from '../validators/complaints.js';
import { emptyCommand } from '../validators/projects.js';
import { createComplaintController } from '../controllers/complaint.controller.js';

export function createComplaintRouter(service, authService) {
  const router = Router();
  const controller = createComplaintController(service);
  const clientMiddleware = [authMiddleware(authService), roleMiddleware('CLIENT')];

  const writeRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Слишком много жалоб. Повторите позже')),
  });

  router.get(
    '/orders/:orderId/complaints',
    ...clientMiddleware,
    validate(orderParams, 'params'),
    validate(orderDetailQuery, 'query'),
    asyncHandler(controller.order),
  );

  router.post(
    '/orders/:orderId/complaints',
    ...clientMiddleware,
    writeRateLimit,
    validate(orderParams, 'params'),
    validate(orderDetailQuery, 'query'),
    validate(complaintInput),
    asyncHandler(controller.create),
  );

  router.get(
    '/me/complaints',
    ...clientMiddleware,
    validate(complaintQuery, 'query'),
    asyncHandler(controller.list),
  );

  router.get(
    '/me/complaints/:complaintId',
    ...clientMiddleware,
    validate(complaintParams, 'params'),
    validate(orderDetailQuery, 'query'),
    asyncHandler(controller.own),
  );

  router.put(
    '/me/complaints/:complaintId',
    ...clientMiddleware,
    writeRateLimit,
    validate(complaintParams, 'params'),
    validate(complaintInput),
    asyncHandler(controller.update),
  );

  router.delete(
    '/me/complaints/:complaintId',
    ...clientMiddleware,
    writeRateLimit,
    validate(complaintParams, 'params'),
    validate(emptyCommand),
    asyncHandler(controller.remove),
  );

  return router;
}
