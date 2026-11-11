import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';

import {
  adminAccountCreate,
  adminAccountUpdate,
  adminAccountDelete,
  adminUserQuery,
  adminComplaintQuery,
  adminBlock,
  adminUnblock,
  adminReject,
  adminResolve,
  adminContextParams,
} from '../validators/admin.js';
import { complaintParams } from '../validators/complaints.js';
import { workQuery } from '../validators/order-work.js';
import { orderDetailQuery } from '../validators/orders.js';
import { profileParams } from '../validators/profile.js';
import { emptyCommand } from '../validators/projects.js';

import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

import { createAdminController } from '../controllers/admin.controller.js';

export function createAdminRouter(service, authService) {
  const router = Router();
  const controller = createAdminController(service);
  const adminMiddleware = [authMiddleware(authService), roleMiddleware('ADMIN')];

  const writeRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Слишком много решений. Повторите позже')),
  });

  router.post(
    '/admin/users',
    ...adminMiddleware,
    writeRateLimit,
    validate(adminAccountCreate),
    asyncHandler(controller.createUser),
  );

  router.patch(
    '/admin/users/:userId',
    ...adminMiddleware,
    writeRateLimit,
    validate(profileParams, 'params'),
    validate(adminAccountUpdate),
    asyncHandler(controller.updateUser),
  );

  router.delete(
    '/admin/users/:userId',
    ...adminMiddleware,
    writeRateLimit,
    validate(profileParams, 'params'),
    validate(adminAccountDelete),
    asyncHandler(controller.deleteUser),
  );

  router.get(
    '/admin/users',
    ...adminMiddleware,
    validate(adminUserQuery, 'query'),
    asyncHandler(controller.users),
  );

  router.get(
    '/admin/users/:userId',
    ...adminMiddleware,
    validate(profileParams, 'params'),
    validate(orderDetailQuery, 'query'),
    asyncHandler(controller.user),
  );

  router.get(
    '/admin/users/:userId/sanctions',
    ...adminMiddleware,
    validate(profileParams, 'params'),
    validate(workQuery, 'query'),
    asyncHandler(controller.sanctions),
  );
  for (const [command, rule] of [
    ['block', adminBlock],
    ['unblock', adminUnblock],
  ]) {
    router.post(
      `/admin/users/:userId/${command}`,
      ...adminMiddleware,
      writeRateLimit,
      validate(profileParams, 'params'),
      validate(orderDetailQuery, 'query'),
      validate(rule),
      asyncHandler(controller[command]),
    );
  }

  router.get(
    '/admin/complaints',
    ...adminMiddleware,
    validate(adminComplaintQuery, 'query'),
    asyncHandler(controller.queue),
  );

  router.get(
    '/admin/complaints/:complaintId',
    ...adminMiddleware,
    validate(complaintParams, 'params'),
    validate(orderDetailQuery, 'query'),
    asyncHandler(controller.detail),
  );
  for (const [command, rule] of [
    ['claim', emptyCommand],
    ['reject', adminReject],
    ['resolve', adminResolve],
  ]) {
    router.post(
      `/admin/complaints/:complaintId/${command}`,
      ...adminMiddleware,
      writeRateLimit,
      validate(complaintParams, 'params'),
      validate(orderDetailQuery, 'query'),
      validate(rule),
      asyncHandler(controller[command]),
    );
  }

  router.get(
    '/admin/complaints/:complaintId/:section',
    ...adminMiddleware,
    validate(adminContextParams, 'params'),
    validate(workQuery, 'query'),
    asyncHandler(controller.context),
  );

  return router;
}
