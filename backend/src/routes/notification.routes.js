import { Router } from 'express';
import { authMiddleware, authCsrf } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { createNotificationController } from '../controllers/notification.controller.js';
import {
  notificationQuery,
  notificationParams,
  notificationEmpty,
  notificationEmptyQuery,
} from '../validators/notifications.js';

export function createNotificationRouter(service, authService) {
  const router = Router();
  const controller = createNotificationController(service);
  const authenticate = authMiddleware(authService);

  router.get(
    '/me/notifications',
    authenticate,
    validate(notificationQuery, 'query'),
    asyncHandler(controller.list),
  );

  router.get(
    '/me/notifications/unread',
    authenticate,
    validate(notificationEmptyQuery, 'query'),
    asyncHandler(controller.unread),
  );

  router.post(
    '/me/notifications/read-all',
    authenticate,
    authCsrf,
    validate(notificationEmptyQuery, 'query'),
    validate(notificationEmpty),
    asyncHandler(controller.markAllRead),
  );

  router.post(
    '/me/notifications/:notificationId/read',
    authenticate,
    authCsrf,
    validate(notificationParams, 'params'),
    validate(notificationEmptyQuery, 'query'),
    validate(notificationEmpty),
    asyncHandler(controller.markRead),
  );

  return router;
}
