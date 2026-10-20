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
import {createReviewRouter} from './review.routes.js';
import {createComplaintRouter} from './complaint.routes.js';
import {createWarningRouter} from './warning.routes.js';
import {createAdminRouter} from './admin.routes.js';
import {createAuditRouter} from './audit.routes.js';

export function createApiRouter({ healthService, authService, authConfig, profileService, fileService, portfolioService, projectService, proposalService, freelancerService, invitationService, orderService, orderWorkService, reviewService, complaintService, warningService, adminService, auditService }) {
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
  if(orderService)router.use(createOrderRouter(orderService,authService,orderWorkService));
  if(reviewService)router.use(createReviewRouter(reviewService,authService));
  if(complaintService)router.use(createComplaintRouter(complaintService,authService));
  if(warningService)router.use(createWarningRouter(warningService,authService));
  if(adminService)router.use(createAdminRouter(adminService,authService));
  if(auditService)router.use(createAuditRouter(auditService,authService));
  return router;
}
