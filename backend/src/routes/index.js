import { Router } from 'express';
import { createHealthRouter } from './health.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createProfileRouter } from './profile.routes.js';
import { createFileRouter } from './file.routes.js';
import { createPortfolioRouter } from './portfolio.routes.js';
import { createProjectRouter } from './project.routes.js';
import { createProposalRouter } from './proposal.routes.js';
import {createFreelancerRouter} from './freelancer.routes.js';
import {createInvitationRouter} from './invitation.routes.js';
import {createOrderRouter} from './order.routes.js';

export function createApiRouter({ healthService, authService, authConfig, profileService, fileService, portfolioService, projectService, proposalService, freelancerService, invitationService, orderService }) {
  const router = Router();
  router.use(createHealthRouter(healthService));
  if (authService) router.use(createAuthRouter(authService, authConfig));
  if (profileService) router.use(createProfileRouter(profileService, authService));
  if (fileService) router.use(createFileRouter(fileService, authService));
  if (portfolioService) router.use(createPortfolioRouter(portfolioService, authService));
  if (projectService) router.use(createProjectRouter(projectService, authService));
  if (proposalService) router.use(createProposalRouter(proposalService, authService));
  if(freelancerService)router.use(createFreelancerRouter(freelancerService));
  if(invitationService)router.use(createInvitationRouter(invitationService,authService));
  if(orderService)router.use(createOrderRouter(orderService,authService));
  return router;
}
