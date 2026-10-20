import express from 'express';
import helmet from 'helmet';
import { requestId } from './middleware/request-id.js';
import { notFound } from './middleware/not-found.js';
import { createErrorHandler } from './middleware/error-handler.js';
import {auditContext} from './utils/audit-context.js';

export function createApp({ apiRouter, jsonLimitBytes = 65536, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(requestId);
  app.use(auditContext);
  app.use(helmet());
  app.use(express.json({ limit: jsonLimitBytes, strict: true, type: ['application/json', 'application/*+json'] }));
  app.use('/api', apiRouter);
  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
