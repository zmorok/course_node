import express from 'express';
import helmet from 'helmet';
import { requestId } from './middleware/request-id.js';
import { notFound } from './middleware/not-found.js';
import { createErrorHandler } from './middleware/error-handler.js';
import { auditContext } from './utils/audit-context.js';

export function createApp({
  apiRouter,
  jsonLimitBytes = 65536,
  trustProxyHops = 0,
  logger = console,
}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.use(requestId);
  app.use(auditContext);
  app.use(helmet());
  app.use(
    express.json({ limit: jsonLimitBytes, type: ['application/json', 'application/*+json'] }),
  );
  app.use('/api', apiRouter);
  app.use(notFound);
  app.use(createErrorHandler(logger));

  return app;
}
