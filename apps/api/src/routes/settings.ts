import { Router } from 'express';
import type { Pool } from 'pg';
import { DEFAULT_PORT_SETTINGS, type PortSettings } from '@bannerlord-panel/shared';
import type { AgentGateway } from '../agent/gateway.js';

export function createSettingsRouter(
  pool: Pool,
  gateway: AgentGateway,
): Router {
  const router = Router();

  router.get('/settings/ports', async (_req, res, next) => {
    try {
      const { rows } = await pool.query<{ value: PortSettings }>(
        `SELECT value FROM settings WHERE key = 'ports'`,
      );
      res.json({
        ports: rows[0]?.value ?? DEFAULT_PORT_SETTINGS,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/internal/agent-connections', (_req, res) => {
    res.json({
      connectedHostIds: gateway.getConnectedHostIds(),
    });
  });

  return router;
}
