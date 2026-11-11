import { Router } from 'express';

import { asyncHandler } from '../utils/async-handler.js';
import { createRateLimit } from '../utils/rate-limit.js';

import { complaintInput, complaintParams, complaintQuery } from '../validators/complaints.js';
import { orderParams, orderDetailQuery } from '../validators/orders.js';
import { emptyCommand } from '../validators/projects.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createComplaintController } from '../controllers/complaint.controller.js';

export function createComplaintRouter(service, authService) {
  const router = Router();
  const controller = createComplaintController(service);
  const clientMiddleware = [authMiddleware(authService), roleMiddleware('CLIENT')];

  const writeRateLimit = createRateLimit(15, 30);

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
