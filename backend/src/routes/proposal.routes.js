import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authMiddleware,roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { AppError } from '../utils/app-error.js';
import { projectParams,emptyCommand } from '../validators/projects.js';
import { proposalCreate,proposalParams,proposalReject,projectProposalQuery,ownProposalQuery } from '../validators/proposals.js';
import { createProposalController } from '../controllers/proposal.controller.js';
export function createProposalRouter(service,authService){
  const router=Router(),controller=createProposalController(service),auth=[authMiddleware(authService),roleMiddleware('CLIENT')];
  const writes=rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,
    handler:(_req,_res,next)=>next(new AppError(429,'RATE_LIMITED','Слишком много действий с откликами. Повторите позже'))});
  router.get('/me/proposals',...auth,validate(ownProposalQuery,'query'),asyncHandler(controller.own));
  router.get('/projects/:projectId/proposals',...auth,validate(projectParams,'params'),validate(projectProposalQuery,'query'),asyncHandler(controller.project));
  router.post('/projects/:projectId/proposals',...auth,writes,validate(projectParams,'params'),validate(proposalCreate),asyncHandler(controller.create));
  router.get('/proposals/:proposalId',...auth,validate(proposalParams,'params'),asyncHandler(controller.get));
  router.post('/proposals/:proposalId/withdraw',...auth,writes,validate(proposalParams,'params'),validate(emptyCommand),asyncHandler(controller.withdraw));
  router.post('/proposals/:proposalId/reject',...auth,writes,validate(proposalParams,'params'),validate(proposalReject),asyncHandler(controller.reject));
  router.post('/proposals/:proposalId/accept',...auth,writes,validate(proposalParams,'params'),validate(emptyCommand),asyncHandler(controller.accept));
  return router;
}
