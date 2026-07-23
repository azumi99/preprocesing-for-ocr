import { Router } from 'express';
import { checkPreprocessDependencies } from '../services/preprocessService.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

healthRouter.get('/ready', async (_req, res) => {
  const result = await checkPreprocessDependencies();
  res.status(result.ok ? 200 : 503).json(result);
});
