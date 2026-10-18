import { mkdir } from 'node:fs/promises';
import { app } from './app.js';
import { env } from './config/env.js';
import { pool } from './config/database.js';

await mkdir(env.uploadDir, { recursive: true });
const server = app.listen(env.port, '0.0.0.0', () => console.log(`Workify API listening on port ${env.port}`));

function shutdown() {
  const timeout = setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    await pool.end();
    clearTimeout(timeout);
    process.exit(0);
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
