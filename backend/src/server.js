import { mkdir } from 'node:fs/promises';

// настройка приложения, конфигурация, руты
import { createApp } from './app.js';
import { ConfigurationError, loadConfig } from './config/env.js';
import { createDatabasePool } from './config/database.js';
import { createPrismaClient } from './config/prisma.js';
import { createApiRouter } from './routes/index.js';

// репозитории и обработчики транзакции
import { createAdminRepository } from './repositories/admin.repository.js';
import { createAssignmentRepository } from './repositories/assignment.repository.js';
import { createAuditRepository } from './repositories/audit.repository.js';
import { createAuthRepository } from './repositories/auth.repository.js';
import { createComplaintRepository } from './repositories/complaint.repository.js';
import { createFileRepository } from './repositories/file.repository.js';
import { createFreelancerRepository } from './repositories/freelancer.repository.js';
import { createHealthRepository } from './repositories/health.repository.js';
import { createInvitationRepository } from './repositories/invitation.repository.js';
import { createNotificationRepository } from './repositories/notification.repository.js';
import { createOrderRepository } from './repositories/order.repository.js';
import { createOrderWorkRepository } from './repositories/order-work.repository.js';
import { createPortfolioRepository } from './repositories/portfolio.repository.js';
import { createProfileRepository } from './repositories/profile.repository.js';
import { createProjectRepository } from './repositories/project.repository.js';
import { createProposalRepository } from './repositories/proposal.repository.js';
import { createReviewRepository } from './repositories/review.repository.js';
import { withTransaction } from './repositories/transaction.js';
import { createWarningRepository } from './repositories/warning.repository.js';

// сервисы
import { createAdminService } from './services/admin.service.js';
import { createAssignmentService } from './services/assignment.service.js';
import { createAuditService } from './services/audit.service.js';
import { createAuthService } from './services/auth.service.js';
import { createComplaintService } from './services/complaint.service.js';
import { createFileService } from './services/file.service.js';
import { createFreelancerService } from './services/freelancer.service.js';
import { createHealthService } from './services/health.service.js';
import { createInvitationService } from './services/invitation.service.js';
import { createNotificationService } from './services/notification.service.js';
import { createOrderService } from './services/order.service.js';
import { createOrderWorkService } from './services/order-work.service.js';
import { createPortfolioService } from './services/portfolio.service.js';
import { createProfileService } from './services/profile.service.js';
import { createProjectService } from './services/project.service.js';
import { createProposalService } from './services/proposal.service.js';
import { createReviewService } from './services/review.service.js';
import { createWarningService } from './services/warning.service.js';

// вспомогательные методы для файлового хранилища и токенов
import { createLocalStorage } from './storage/local-storage.js';
import { createAccessTokens } from './utils/tokens.js';

let pool;
let prisma;

try {
  const config = loadConfig();

  await mkdir(config.uploadDir, { recursive: true });
  pool = createDatabasePool(config.database);
  prisma = createPrismaClient(pool);

  // сервис проверки состояния: доступность базы данных и хранилища
  const healthRepository = createHealthRepository(prisma);
  const healthService = createHealthService({ healthRepository, uploadDir: config.uploadDir });

  // сервис авторизации: регистрация, вход, токены и сессии
  const authService = await createAuthService({
    repository: createAuthRepository(prisma),
    transaction: (operation) =>
      withTransaction(prisma, (client) => operation(createAuthRepository(client))),
    accessTokens: createAccessTokens(config.auth),
    sessionTtlDays: config.auth.sessionTtlDays,
  });

  // сервис профиля: личные данные, навыки и смена пароля
  const profileService = createProfileService({
    repository: createProfileRepository(prisma),
    transaction: (operation) =>
      withTransaction(prisma, (client) => operation(createProfileRepository(client))),
  });

  // сервис файлов: загрузка, доступ, аватары и удаление
  const fileService = createFileService({
    repository: createFileRepository(prisma),
    storage: createLocalStorage(config.uploadDir),
    transaction: (operation) =>
      withTransaction(prisma, (client) => operation(createFileRepository(client))),
  });

  // выполнение удаления файлов, которые ранее были запланированы на удаление
  // т.е. удаление из хранилища удалённых файлов из платформы
  await fileService.drainDeletes();
  const cleanupTimer = setInterval(() => fileService.drainDeletes(), 60_000).unref();

  // сервис портфолио: работы пользователя, навыки и вложения
  const portfolioService = createPortfolioService({
    repository: createPortfolioRepository(prisma),
    fileService,
    transaction: (operation) =>
      withTransaction(prisma, (client) =>
        operation(createPortfolioRepository(client), createFileRepository(client)),
      ),
  });

  // сервис проектов: каталог, черновики, публикация и отмена
  const projectService = createProjectService({
    repository: createProjectRepository(prisma),
    fileService,
    transaction: (operation) =>
      withTransaction(prisma, (client) =>
        operation(createProjectRepository(client), createFileRepository(client)),
      ),
  });

  // сервис откликов: подача, изменение, отзыв и выбор исполнителя
  const proposalService = createProposalService({
    repository: createProposalRepository(prisma),
    assignmentService: createAssignmentService(),
    transaction: (operation) =>
      withTransaction(prisma, (client) =>
        operation(createProposalRepository(client), createAssignmentRepository(client)),
      ),
  });

  // сервис поиска исполнителей: каталог, фильтры и сортировка
  const freelancerService = createFreelancerService({
    repository: createFreelancerRepository(prisma),
  });

  // сервис приглашений: предложение условий, принятие и отклонение
  const invitationService = createInvitationService({
    repository: createInvitationRepository(prisma),
    assignmentService: createAssignmentService(),
    transaction: (operation) =>
      withTransaction(prisma, (client) =>
        operation(
          createInvitationRepository(client),
          createAssignmentRepository(client),
          createProposalRepository(client),
        ),
      ),
  });

  // сервис просмотра заказов: списки, история и права участников
  const orderService = createOrderService({ repository: createOrderRepository(prisma) });

  // сервис выполнения заказов: результаты, доработки, сроки и завершение
  const orderWorkService = createOrderWorkService({
    repository: createOrderWorkRepository(prisma),
    orders: createOrderRepository(prisma),
    fileService,
    transaction: (operation) =>
      withTransaction(prisma, (client) =>
        operation(
          createOrderWorkRepository(client),
          createOrderRepository(client),
          createFileRepository(client),
        ),
      ),
  });

  // сервис отзывов: оценки, редактирование и публичные рейтинги
  const reviewService = createReviewService({
    repository: createReviewRepository(prisma),
    transaction: (operation) =>
      withTransaction(prisma, (client) => operation(createReviewRepository(client))),
  });

  // сервис жалоб: подача, изменение и просмотр обращений
  const complaintService = createComplaintService({
    repository: createComplaintRepository(prisma),
    fileService,
    transaction: (operation) =>
      withTransaction(prisma, (client) =>
        operation(createComplaintRepository(client), createFileRepository(client)),
      ),
  });

  // сервис предупреждений: выдача и отметка о прочтении
  const warningService = createWarningService({
    repository: createWarningRepository(prisma),
    transaction: (operation) =>
      withTransaction(prisma, (client) => operation(createWarningRepository(client))),
  });

  // сервис администрирования: пользователи, жалобы, санкции и блокировки
  const adminService = createAdminService({
    repository: createAdminRepository(prisma),
    transaction: (operation) =>
      withTransaction(prisma, (client) => operation(createAdminRepository(client))),
  });

  // сервис уведомлений: список, счётчик непрочитанных и отметки о прочтении
  const notificationService = createNotificationService({
    repository: createNotificationRepository(prisma),
  });

  // сервис аудита: журнал событий, фильтры, импорт и экспорт
  const auditService = createAuditService({
    repository: createAuditRepository(prisma),
    transaction: (operation) =>
      withTransaction(prisma, (client) => operation(createAuditRepository(client))),
  });

  // внедрение сервисов в API-роутер приложения
  const apiRouter = createApiRouter({
    healthService,
    authService,
    authConfig: config.auth,
    profileService,
    fileService,
    portfolioService,
    projectService,
    proposalService,
    freelancerService,
    invitationService,
    orderService,
    orderWorkService,
    reviewService,
    complaintService,
    warningService,
    adminService,
    auditService,
    notificationService,
  });

  const app = createApp({
    apiRouter,
    jsonLimitBytes: config.jsonLimitBytes,
    trustProxyHops: config.trustProxyHops,
  });

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(config.port, '0.0.0.0', () => resolve(listener));

    listener.once('error', reject);
  });

  console.log(`Workify API listening on port ${config.port}`);

  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    clearInterval(cleanupTimer);

    const timeout = setTimeout(() => process.exit(1), 10000).unref();

    server.close(async () => {
      try {
        await prisma.$disconnect();
        await pool.end();
        clearTimeout(timeout);
        process.exit(0);
      } catch {
        console.error(JSON.stringify({ event: 'shutdown_failed' }));
        process.exit(1);
      }
    });
  };

  process.once('SIGTERM', shutdown); // Docker - SIGTERM
  process.once('SIGINT', shutdown); // User Ctrl+C - SIGINT
} catch (error) {
  console.error(
    error instanceof ConfigurationError
      ? error.message
      : JSON.stringify({ event: 'startup_failed' }),
  );

  try {
    await prisma?.$disconnect();
    await pool?.end();
  } catch {
    console.error(JSON.stringify({ event: 'shutdown_failed' }));
  }

  process.exitCode = 1;
}
