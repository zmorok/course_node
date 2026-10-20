import {Router} from 'express';
import {authMiddleware,roleMiddleware} from '../middleware/auth.js';
import {validate} from '../middleware/validate.js';
import {asyncHandler} from '../utils/async-handler.js';
import {auditQuery} from '../validators/audit.js';
import {createAuditController} from '../controllers/audit.controller.js';
export function createAuditRouter(service,authService){const router=Router(),controller=createAuditController(service);router.get('/admin/audit',authMiddleware(authService),roleMiddleware('ADMIN'),validate(auditQuery,'query'),asyncHandler(controller.list));return router;}
