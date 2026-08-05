import { Router } from 'express';
import type { Pool } from 'pg';

export function createHealthRouter(pool: Pool): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({
        ok: true,
        service: 'api',
        database: 'up',
        at: new Date().toISOString(),
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        service: 'api',
        database: 'down',
        error: err instanceof Error ? err.message : 'database error',
        at: new Date().toISOString(),
      });
    }
  });

  return router;
}
