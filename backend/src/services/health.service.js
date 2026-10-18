import { access, constants } from 'node:fs/promises';

export function createHealthService({ healthRepository, uploadDir, checkStorage = access }) {
  return {
    async getHealth() {
      const results = await Promise.allSettled([
        healthRepository.ping(),
        checkStorage(uploadDir, constants.R_OK | constants.W_OK),
      ]);
      const checks = {
        database: results[0].status === 'fulfilled' && results[0].value === true ? 'up' : 'down',
        uploads: results[1].status === 'fulfilled' ? 'up' : 'down',
      };
      return { status: Object.values(checks).every(value => value === 'up') ? 'ok' : 'error', checks };
    },
  };
}
