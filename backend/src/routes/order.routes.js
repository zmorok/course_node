import {Router} from 'express';
import {authMiddleware,roleMiddleware} from '../middleware/auth.js';
import {validate} from '../middleware/validate.js';
import {asyncHandler} from '../utils/async-handler.js';
import {orderQuery,orderParams,orderDetailQuery} from '../validators/orders.js';
import {createOrderController} from '../controllers/order.controller.js';
export function createOrderRouter(service,authService){
  const router=Router(),controller=createOrderController(service),auth=[authMiddleware(authService),roleMiddleware('CLIENT')];
  router.get('/me/orders',...auth,validate(orderQuery,'query'),asyncHandler(controller.own));
  router.get('/orders/:orderId',...auth,validate(orderParams,'params'),validate(orderDetailQuery,'query'),asyncHandler(controller.get));
  return router;
}
