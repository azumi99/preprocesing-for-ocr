import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import { apiReference } from '@scalar/express-api-reference';
import { port } from './src/config/constants.js';
import { createOpenApiDocument } from './src/docs/openapi.js';
import { healthRouter } from './src/routes/health.js';
import { preprocessRouter } from './src/routes/preprocess.js';

const app = express();
const openApiDocument = createOpenApiDocument(port);

app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(openApiDocument);
});

app.use('/docs', apiReference({ spec: { content: openApiDocument } }));
app.use(healthRouter);
app.use(preprocessRouter);

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: error.message });
});

app.listen(port, () => {
  console.log(`OCR preprocessing API running at http://localhost:${port}`);
  console.log(`Scalar docs available at http://localhost:${port}/docs`);
});
