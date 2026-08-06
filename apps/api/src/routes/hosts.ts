import { Router } from 'express';
import type { ApiConfig } from '../config.js';
import type { HostRegistry } from '../services/host-registry.js';
import type { UserRegistry } from '../services/user-registry.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

export function createHostsRouter(deps: {
  config: ApiConfig;
  hosts: HostRegistry;
  users: UserRegistry;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);
  const canRead = requirePermission('hosts:read');

  router.get('/hosts', auth, canRead, async (_req, res, next) => {
    try {
      const list = await deps.hosts.listHosts();
      res.json({ hosts: list });
    } catch (err) {
      next(err);
    }
  });

  router.get('/hosts/:id', auth, canRead, async (req, res, next) => {
    try {
      const host = await deps.hosts.getHost(req.params.id);
      if (!host) {
        res.status(404).json({ error: 'Host not found' });
        return;
      }
      res.json({ host });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
