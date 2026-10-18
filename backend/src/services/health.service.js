import { access, constants } from 'node:fs/promises';
import { env } from '../config/env.js';
import { checkDatabase } from '../repositories/health.repository.js';

export async function getHealth() {
  const results = await Promise.allSettled([
    checkDatabase(),
    access(env.uploadDir, constants.R_OK | constants.W_OK),
  ]);
  const checks = {
    database: results[0].status === 'fulfilled' ? 'up' : 'down',
    uploads: results[1].status === 'fulfilled' ? 'up' : 'down',
  };
  return { status: Object.values(checks).every(value => value === 'up') ? 'ok' : 'error', checks };
}
