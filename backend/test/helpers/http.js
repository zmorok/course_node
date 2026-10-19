import { createApp } from '../../src/app.js';

export async function startApp(context, apiRouter, options = {}) {
  const logs = [];
  const app = createApp({ apiRouter, logger: { error: message => logs.push(message) }, ...options });
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    listener.once('error', reject);
  });
  context.after(() => new Promise(resolve => server.close(resolve)));
  return {
    logs,
    async request(path, options) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        ...options, signal: AbortSignal.timeout(5000),
      });
      return { response, body: response.status === 204 ? null : response.headers.get('content-type')?.includes('application/json')
        ? await response.json() : Buffer.from(await response.arrayBuffer()) };
    },
  };
}
