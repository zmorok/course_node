import {AppError} from '../utils/app-error.js';
import {auditUpload} from '../middleware/audit-upload.js';
import {rateLimit} from 'express-rate-limit';
import {Router} from 'express';
import {authMiddleware,roleMiddleware} from '../middleware/auth.js';
import {validate} from '../middleware/validate.js';
import {asyncHandler} from '../utils/async-handler.js';
import {auditQuery} from '../validators/audit.js';
import {createAuditController} from '../controllers/audit.controller.js';
export function createAuditRouter(service,authService){const router=Router(),controller=createAuditController(service);const writes=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,handler:(_req,_res,next)=>next(new AppError(429,'RATE_LIMITED','Слишком много изменений. Повторите позже'))});router.get('/admin/audit/export',authMiddleware(authService),roleMiddleware('ADMIN'),validate(auditQuery,'query'),asyncHandler(controller.export));router.get('/admin/audit/imported',authMiddleware(authService),roleMiddleware('ADMIN'),validate(auditQuery,'query'),asyncHandler(controller.imported));router.post('/admin/audit/import',authMiddleware(authService),roleMiddleware('ADMIN'),writes,auditUpload,asyncHandler(controller.import));router.get('/admin/audit',authMiddleware(authService),roleMiddleware('ADMIN'),validate(auditQuery,'query'),asyncHandler(controller.list));return router;}
