import express from 'express';
import { requestId } from './middleware/request-id.js';
import { notFound } from './middleware/not-found.js';
import { createErrorHandler } from './middleware/error-handler.js';

export function createApp({ apiRouter, jsonLimitBytes = 65536, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(requestId);
  app.use(express.json({ limit: jsonLimitBytes, strict: true, type: ['application/json', 'application/*+json'] }));
  app.use('/api', apiRouter);
  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
