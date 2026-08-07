import { Router } from 'express';
import { z } from 'zod';
import type { ModpackPreset, ScannedModule } from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import type { AgentGateway } from '../agent/gateway.js';
import type { HostRegistry } from '../services/host-registry.js';
import type { InstallationRegistry } from '../services/installation-registry.js';
import type { UserRegistry } from '../services/user-registry.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

const putSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(128),
  enabledOrderedIds: z.array(z.string().min(1)).min(1),
});

export function createModpacksRouter(deps: {
  config: ApiConfig;
  hosts: HostRegistry;
  installations: InstallationRegistry;
  users: UserRegistry;
  gateway: AgentGateway;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);
  const canRead = requirePermission('servers:read');
  const canWritePacks = requirePermission('installations:write');

  router.get(
    '/hosts/:hostId/modules',
    auth,
    canRead,
    async (req, res, next) => {
      try {
        const host = await deps.hosts.getHost(req.params.hostId);
        if (!host) {
          res.status(404).json({ error: 'Host not found' });
          return;
        }
        if (!deps.gateway.isHostConnected(host.id)) {
          res.status(503).json({ error: 'Host agent is offline' });
          return;
        }

        let installationPath: string | undefined;
        const installationId =
          typeof req.query.installationId === 'string'
            ? req.query.installationId
            : undefined;
        if (installationId) {
          const installation = await deps.installations.get(installationId);
          if (!installation || installation.hostId !== host.id) {
            res.status(404).json({ error: 'Installation not found on host' });
            return;
          }
          installationPath = installation.path;
        } else {
          const list = await deps.installations.list(host.id);
          installationPath = list[0]?.path;
        }

        const response = await deps.gateway.request(host.id, 'modules.scan', {
          installationPath,
        });
        if (!response.ok) {
          res
            .status(502)
            .json({ error: response.error ?? 'Failed to scan modules' });
          return;
        }
        res.json({
          modules: (response.result as { modules: ScannedModule[] }).modules,
          installationPath: installationPath ?? null,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/hosts/:hostId/modpacks',
    auth,
    canRead,
    async (req, res, next) => {
      try {
        const host = await deps.hosts.getHost(req.params.hostId);
        if (!host) {
          res.status(404).json({ error: 'Host not found' });
          return;
        }
        if (!deps.gateway.isHostConnected(host.id)) {
          res.status(503).json({ error: 'Host agent is offline' });
          return;
        }
        const response = await deps.gateway.request(
          host.id,
          'modpacks.list',
          {},
        );
        if (!response.ok) {
          res
            .status(502)
            .json({ error: response.error ?? 'Failed to list modpacks' });
          return;
        }
        res.json({ modpacks: response.result as ModpackPreset[] });
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    '/hosts/:hostId/modpacks',
    auth,
    canWritePacks,
    async (req, res, next) => {
      try {
        const body = putSchema.parse(req.body);
        const host = await deps.hosts.getHost(req.params.hostId);
        if (!host) {
          res.status(404).json({ error: 'Host not found' });
          return;
        }
        if (!deps.gateway.isHostConnected(host.id)) {
          res.status(503).json({ error: 'Host agent is offline' });
          return;
        }
        const response = await deps.gateway.request(host.id, 'modpacks.put', {
          id: body.id,
          name: body.name,
          enabledOrderedIds: body.enabledOrderedIds,
        });
        if (!response.ok) {
          res
            .status(502)
            .json({ error: response.error ?? 'Failed to save modpack' });
          return;
        }
        res.json({ modpack: response.result as ModpackPreset });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: err.flatten() });
          return;
        }
        next(err);
      }
    },
  );

  router.delete(
    '/hosts/:hostId/modpacks/:id',
    auth,
    canWritePacks,
    async (req, res, next) => {
      try {
        const host = await deps.hosts.getHost(req.params.hostId);
        if (!host) {
          res.status(404).json({ error: 'Host not found' });
          return;
        }
        if (!deps.gateway.isHostConnected(host.id)) {
          res.status(503).json({ error: 'Host agent is offline' });
          return;
        }
        const response = await deps.gateway.request(
          host.id,
          'modpacks.delete',
          { id: req.params.id },
        );
        if (!response.ok) {
          res
            .status(502)
            .json({ error: response.error ?? 'Failed to delete modpack' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
