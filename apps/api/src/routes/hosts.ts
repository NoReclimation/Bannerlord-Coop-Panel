import { Router } from 'express';
import type { HostRegistry } from '../services/host-registry.js';

export function createHostsRouter(hosts: HostRegistry): Router {
  const router = Router();

  router.get('/hosts', async (_req, res, next) => {
    try {
      const list = await hosts.listHosts();
      res.json({ hosts: list });
    } catch (err) {
      next(err);
    }
  });

  router.get('/hosts/:id', async (req, res, next) => {
    try {
      const host = await hosts.getHost(req.params.id);
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
