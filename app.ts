import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import { apiReference } from '@scalar/express-api-reference';
import { host, port, requestTimeoutMs } from './src/config/constants.js';
import { createOpenApiDocument } from './src/docs/openapi.js';
import { healthRouter } from './src/routes/health.js';
import { preprocessRouter } from './src/routes/preprocess.js';

const app = express();
const openApiDocument = createOpenApiDocument(port);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = req.header('x-request-id') || randomUUID();
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiDocument);
});

app.use('/docs', apiReference({
  cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference/dist/browser/standalone.js',
  spec: { content: openApiDocument }
}));
app.use(healthRouter);
app.use(preprocessRouter);

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: error.message || 'Bad request' });
});

const server = app.listen(port, host, () => {
  console.log(`OCR preprocessing API running at http://${host}:${port}`);
  console.log(`Scalar docs available at http://${host}:${port}/docs`);
});

server.requestTimeout = requestTimeoutMs;
server.headersTimeout = requestTimeoutMs + 5_000;
server.keepAliveTimeout = 65_000;

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received, shutting down HTTP server`);
  server.close((error) => {
    if (error) {
      console.error('HTTP server shutdown failed', error);
      process.exit(1);
    }

    process.exit(0);
  });

  setTimeout(() => {
    console.error('HTTP server shutdown timed out');
    process.exit(1);
  }, 30_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
