import { Router } from 'express';
import type { Pool } from 'pg';
import { DEFAULT_PORT_SETTINGS, type PortSettings } from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import type { AgentGateway } from '../agent/gateway.js';
import type { UserRegistry } from '../services/user-registry.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

export function createSettingsRouter(deps: {
  config: ApiConfig;
  pool: Pool;
  gateway: AgentGateway;
  users: UserRegistry;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);
  const canRead = requirePermission('settings:read');

  router.get('/settings/ports', auth, canRead, async (_req, res, next) => {
    try {
      const { rows } = await deps.pool.query<{ value: PortSettings }>(
        `SELECT value FROM settings WHERE key = 'ports'`,
      );
      res.json({
        ports: rows[0]?.value ?? DEFAULT_PORT_SETTINGS,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/internal/agent-connections', auth, canRead, (_req, res) => {
    res.json({
      connectedHostIds: deps.gateway.getConnectedHostIds(),
    });
  });

  return router;
}
