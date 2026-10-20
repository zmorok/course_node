import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {authMiddleware,roleMiddleware} from '../middleware/auth.js';
import {validate} from '../middleware/validate.js';
import {asyncHandler} from '../utils/async-handler.js';
import {AppError} from '../utils/app-error.js';
import {orderDetailQuery} from '../validators/orders.js';
import {profileParams} from '../validators/profile.js';
import {warningInput,warningQuery} from '../validators/warnings.js';
import {createWarningController} from '../controllers/warning.controller.js';
export function createWarningRouter(service,authService){const router=Router(),controller=createWarningController(service),auth=authMiddleware(authService);
  router.get('/me/warnings',auth,roleMiddleware('CLIENT'),validate(warningQuery,'query'),asyncHandler(controller.list));
  const writes=rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,handler:(_req,_res,next)=>next(new AppError(429,'RATE_LIMITED','Слишком много предупреждений. Повторите позже'))});
  router.post('/admin/users/:userId/warnings',auth,roleMiddleware('ADMIN'),writes,validate(profileParams,'params'),validate(orderDetailQuery,'query'),validate(warningInput),asyncHandler(controller.issue));
  return router;
}
