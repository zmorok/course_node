import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {authMiddleware,roleMiddleware} from '../middleware/auth.js';
import {validate} from '../middleware/validate.js';
import {asyncHandler} from '../utils/async-handler.js';
import {AppError} from '../utils/app-error.js';
import {projectParams,emptyCommand} from '../validators/projects.js';
import {profileParams} from '../validators/profile.js';
import {invitationCreate,invitationDecline,invitationParams,projectInvitationQuery,ownInvitationQuery} from '../validators/invitations.js';
import {createInvitationController} from '../controllers/invitation.controller.js';
export function createInvitationRouter(service,authService){
  const router=Router(),controller=createInvitationController(service),auth=[authMiddleware(authService),roleMiddleware('CLIENT')];
  const writes=rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,handler:(_req,_res,next)=>next(new AppError(429,'RATE_LIMITED','Слишком много действий с приглашениями. Повторите позже'))});
  router.get('/freelancers/:userId/projects',...auth,validate(profileParams,'params'),asyncHandler(controller.projects));
  router.get('/me/invitations',...auth,validate(ownInvitationQuery,'query'),asyncHandler(controller.own));
  router.get('/projects/:projectId/invitations',...auth,validate(projectParams,'params'),validate(projectInvitationQuery,'query'),asyncHandler(controller.project));
  router.post('/projects/:projectId/invitations',...auth,writes,validate(projectParams,'params'),validate(invitationCreate),asyncHandler(controller.create));
  router.get('/invitations/:invitationId',...auth,validate(invitationParams,'params'),asyncHandler(controller.get));
  router.post('/invitations/:invitationId/accept',...auth,writes,validate(invitationParams,'params'),validate(emptyCommand),asyncHandler(controller.accept));
  router.post('/invitations/:invitationId/decline',...auth,writes,validate(invitationParams,'params'),validate(invitationDecline),asyncHandler(controller.decline));
  return router;
}
