import { mkdir } from 'node:fs/promises';
import { createApp } from './app.js';
import { ConfigurationError, loadConfig } from './config/env.js';
import { createDatabasePool } from './config/database.js';
import { createHealthRepository } from './repositories/health.repository.js';
import { createHealthService } from './services/health.service.js';
import { createApiRouter } from './routes/index.js';

let pool;
try {
  const config = loadConfig();
  await mkdir(config.uploadDir, { recursive: true });
  pool = createDatabasePool(config.database);
  const healthRepository = createHealthRepository(pool);
  const healthService = createHealthService({ healthRepository, uploadDir: config.uploadDir });
  const apiRouter = createApiRouter({ healthService });
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
