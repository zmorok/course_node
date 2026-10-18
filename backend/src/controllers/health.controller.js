import { getHealth } from '../services/health.service.js';

export async function healthController(_request, response) {
  const health = await getHealth();
  response.set('Cache-Control', 'no-store').status(health.status === 'ok' ? 200 : 503).json(health);
}
