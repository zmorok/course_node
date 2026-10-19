import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {AppError} from '../utils/app-error.js';
import {authMiddleware,roleMiddleware} from '../middleware/auth.js';
import {validate} from '../middleware/validate.js';
import {asyncHandler} from '../utils/async-handler.js';
import {orderQuery,orderParams,orderDetailQuery} from '../validators/orders.js';
import {createOrderController} from '../controllers/order.controller.js';
import {createOrderWorkController} from '../controllers/order-work.controller.js';
import {submissionCreate,submissionRevision,submissionAccept,deadlineCreate,deadlineReject,deadlineApprove,submissionParams,deadlineParams,workQuery} from '../validators/order-work.js';
export function createOrderRouter(service,authService,workService){
  const router=Router(),controller=createOrderController(service),auth=[authMiddleware(authService),roleMiddleware('CLIENT')];
  router.get('/me/orders',...auth,validate(orderQuery,'query'),asyncHandler(controller.own));
  router.get('/orders/:orderId',...auth,validate(orderParams,'params'),validate(orderDetailQuery,'query'),asyncHandler(controller.get));
  if(workService){
    const work=createOrderWorkController(workService),writes=rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,handler:(_req,_res,next)=>next(new AppError(429,'RATE_LIMITED','Слишком много действий с заказами. Повторите позже'))});
    for(const [suffix,handler] of [['submissions',work.submissions],['deadline-requests',work.deadlines]])router.get(`/orders/:orderId/${suffix}`,...auth,validate(orderParams,'params'),validate(workQuery,'query'),asyncHandler(handler));
    const routes=[['submissions',orderParams,submissionCreate,work.submit],['submissions/:submissionId/revision',submissionParams,submissionRevision,work.revision],['submissions/:submissionId/accept',submissionParams,submissionAccept,work.accept],['deadline-requests',orderParams,deadlineCreate,work.requestDeadline],['deadline-requests/:requestId/approve',deadlineParams,deadlineApprove,work.approve],['deadline-requests/:requestId/reject',deadlineParams,deadlineReject,work.reject]];
    for(const [suffix,params,body,handler] of routes)router.post(`/orders/:orderId/${suffix}`,...auth,writes,validate(params,'params'),validate(orderDetailQuery,'query'),validate(body),asyncHandler(handler));
  }
  return router;
}
