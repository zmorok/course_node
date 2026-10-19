import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'node:url';

const app = express();
const dist = fileURLToPath(new URL('./dist/', import.meta.url));
app.disable('x-powered-by');
app.get('/healthz', (_request, response) => response.set('Cache-Control', 'no-store').json({ status: 'ok' }));
app.use(createProxyMiddleware({
  pathFilter: pathname => pathname === '/api' || pathname.startsWith('/api/'),
  target: process.env.BACKEND_URL || 'http://backend:3000',
  changeOrigin: true,
  proxyTimeout: 60000,
  timeout: 65000,
  on: {
    error: (_error, _request, response) => {
      if (!response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      response.end(JSON.stringify({ status: 'error', message: 'Сервис временно недоступен' }));
    },
  },
}));
app.use(express.static(dist));
app.get('/{*path}', (request, response) => {
  if (request.accepts('html') && !request.path.split('/').at(-1).includes('.')) {
    response.set('Cache-Control', 'no-cache').sendFile(`${dist}index.html`);
  } else {
    response.sendStatus(404);
  }
});

const port = Number(process.env.PORT || 8080);
const server = app.listen(port, '0.0.0.0', () => console.log(`Workify frontend listening on port ${port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(() => process.exit(0)));
