import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { ConfigurationError, loadConfig } from './config/env.js';
import { createDatabasePool } from './config/database.js';
import { createHealthRepository } from './repositories/health.repository.js';
import { createHealthService } from './services/health.service.js';
import { createApiRouter } from './routes/index.js';
import { createAuthRepository } from './repositories/auth.repository.js';
import { withTransaction } from './repositories/transaction.js';
import { createAuthService } from './services/auth.service.js';
import { createAccessTokens } from './utils/tokens.js';
import { createProfileRepository } from './repositories/profile.repository.js';
import { createProfileService } from './services/profile.service.js';
import { createFileRepository } from './repositories/file.repository.js';
import { createFileService } from './services/file.service.js';
import { createLocalStorage } from './storage/local-storage.js';
import { createPortfolioRepository } from './repositories/portfolio.repository.js';
import { createPortfolioService } from './services/portfolio.service.js';
import { createProjectRepository } from './repositories/project.repository.js';
import { createProjectService } from './services/project.service.js';
import { createProposalRepository } from './repositories/proposal.repository.js';
import { createAssignmentRepository } from './repositories/assignment.repository.js';
import { createProposalService } from './services/proposal.service.js';
import { createAssignmentService } from './services/assignment.service.js';
import {createFreelancerRepository} from './repositories/freelancer.repository.js';
import {createFreelancerService} from './services/freelancer.service.js';
import {createInvitationRepository} from './repositories/invitation.repository.js';
import {createInvitationService} from './services/invitation.service.js';
import {createOrderRepository} from './repositories/order.repository.js';
import {createOrderService} from './services/order.service.js';

let pool;
try {
  const config = loadConfig();
  await mkdir(config.uploadDir, { recursive: true });
  pool = createDatabasePool(config.database);
  const healthRepository = createHealthRepository(pool);
  const healthService = createHealthService({ healthRepository, uploadDir: config.uploadDir });
  const authService = await createAuthService({ repository: createAuthRepository(pool),
    transaction: operation => withTransaction(pool, client => operation(createAuthRepository(client))),
    accessTokens: createAccessTokens(config.auth), sessionTtlDays: config.auth.sessionTtlDays });
  const profileService = createProfileService({ repository: createProfileRepository(pool),
    transaction: operation => withTransaction(pool, client => operation(createProfileRepository(client))) });
  const fileService = createFileService({ repository: createFileRepository(pool), storage: createLocalStorage(config.uploadDir),
    transaction: operation => withTransaction(pool, client => operation(createFileRepository(client))) });
  await fileService.drainDeletes();
  const cleanupTimer = setInterval(() => fileService.drainDeletes(), 60_000).unref();
  const portfolioService = createPortfolioService({ repository: createPortfolioRepository(pool), fileService,
    transaction: operation => withTransaction(pool, client => operation(createPortfolioRepository(client), createFileRepository(client))) });
  const projectService = createProjectService({repository:createProjectRepository(pool),fileService,
    transaction:operation=>withTransaction(pool,client=>operation(createProjectRepository(client),createFileRepository(client)))});
  const proposalService=createProposalService({repository:createProposalRepository(pool),assignmentService:createAssignmentService(),
    transaction:operation=>withTransaction(pool,client=>operation(createProposalRepository(client),createAssignmentRepository(client)))});
  const freelancerService=createFreelancerService({repository:createFreelancerRepository(pool)});
  const invitationService=createInvitationService({repository:createInvitationRepository(pool),assignmentService:createAssignmentService(),
    transaction:operation=>withTransaction(pool,client=>operation(createInvitationRepository(client),createAssignmentRepository(client),createProposalRepository(client)))});
  const orderService=createOrderService({repository:createOrderRepository(pool)});
  const apiRouter = createApiRouter({ healthService, authService, authConfig: config.auth, profileService, fileService, portfolioService, projectService, proposalService, freelancerService, invitationService, orderService });
  const app = createApp({ apiRouter, jsonLimitBytes: config.jsonLimitBytes });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(config.port, '0.0.0.0', () => resolve(listener));
    listener.once('error', reject);
  });
  console.log(`Workify API listening on port ${config.port}`);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(cleanupTimer);
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(async () => {
      try {
        await pool.end();
        clearTimeout(timeout);
        process.exit(0);
      } catch {
        console.error(JSON.stringify({ event: 'shutdown_failed' }));
        process.exit(1);
      }
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (error) {
  console.error(error instanceof ConfigurationError ? error.message : JSON.stringify({ event: 'startup_failed' }));
  try {
    await pool?.end();
  } catch {
    console.error(JSON.stringify({ event: 'shutdown_failed' }));
  }
  process.exitCode = 1;
}
