export function createHealthController(healthService) {
  return async function healthController(_request, response) {
    const health = await healthService.getHealth();
    response.set('Cache-Control', 'no-store').status(health.status === 'ok' ? 200 : 503).json(health);
  };
}
