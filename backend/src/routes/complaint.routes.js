import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {authMiddleware,roleMiddleware} from '../middleware/auth.js';
import {validate} from '../middleware/validate.js';
import {asyncHandler} from '../utils/async-handler.js';
import {AppError} from '../utils/app-error.js';
import {orderParams,orderDetailQuery} from '../validators/orders.js';
import {complaintInput,complaintParams,complaintQuery} from '../validators/complaints.js';
import {createComplaintController} from '../controllers/complaint.controller.js';
export function createComplaintRouter(service,authService){const router=Router(),controller=createComplaintController(service),auth=[authMiddleware(authService),roleMiddleware('CLIENT')];
  const writes=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,handler:(_req,_res,next)=>next(new AppError(429,'RATE_LIMITED','Слишком много жалоб. Повторите позже'))});
  router.get('/orders/:orderId/complaints',...auth,validate(orderParams,'params'),validate(orderDetailQuery,'query'),asyncHandler(controller.order));
  router.post('/orders/:orderId/complaints',...auth,writes,validate(orderParams,'params'),validate(orderDetailQuery,'query'),validate(complaintInput),asyncHandler(controller.create));
  router.get('/me/complaints',...auth,validate(complaintQuery,'query'),asyncHandler(controller.list));
  router.get('/me/complaints/:complaintId',...auth,validate(complaintParams,'params'),validate(orderDetailQuery,'query'),asyncHandler(controller.own));
  return router;
}
