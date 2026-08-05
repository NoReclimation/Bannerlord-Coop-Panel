import { Router } from 'express';
import { z } from 'zod';
import type {
  InstallationImportResult,
  InstallationInspectResult,
} from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import type { AgentGateway } from '../agent/gateway.js';
import type { HostRegistry } from '../services/host-registry.js';
import type { InstallationRegistry } from '../services/installation-registry.js';
import type { UserRegistry } from '../services/user-registry.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

const registerSchema = z.object({
  id: z.string().min(1).max(200),
  hostId: z.string().uuid().optional(),
  gameVersion: z.string().min(1),
  coopCommit: z.string().optional(),
  layout: z.string().optional(),
  path: z.string().min(1),
});

const inspectSchema = z.object({
  sourcePath: z.string().min(1),
  hostId: z.string().uuid().optional(),
});

const importSchema = z.object({
  sourcePath: z.string().min(1),
  hostId: z.string().uuid().optional(),
  installationId: z.string().min(1).max(200).optional(),
});

export function createInstallationsRouter(deps: {
  config: ApiConfig;
  hosts: HostRegistry;
  installations: InstallationRegistry;
  gateway: AgentGateway;
  users: UserRegistry;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);

  router.get(
    '/installations',
    auth,
    requirePermission('installations:read'),
    async (req, res, next) => {
      try {
        const hostId =
          typeof req.query.hostId === 'string' ? req.query.hostId : undefined;
        const list = await deps.installations.list(hostId);
        res.json({ installations: list });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/installations/:id',
    auth,
    requirePermission('installations:read'),
    async (req, res, next) => {
      try {
        const installation = await deps.installations.get(req.params.id);
        if (!installation) {
          res.status(404).json({ error: 'Installation not found' });
          return;
        }
        res.json({ installation });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/installations/inspect',
    auth,
    requirePermission('installations:write'),
    async (req, res, next) => {
      try {
        const body = inspectSchema.parse(req.body);
        const hostId = body.hostId ?? deps.config.DEFAULT_HOST_ID;
        if (!deps.gateway.isHostConnected(hostId)) {
          res.status(503).json({ error: 'Host agent is offline' });
          return;
        }
        const response = await deps.gateway.request(
          hostId,
          'installation.inspect',
          { sourcePath: body.sourcePath },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'Inspect failed' });
          return;
        }
        res.json({ inspect: response.result as InstallationInspectResult });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: err.flatten() });
          return;
        }
        next(err);
      }
    },
  );

  router.post(
    '/installations/import',
    auth,
    requirePermission('installations:write'),
    async (req, res, next) => {
      try {
        const body = importSchema.parse(req.body);
        const hostId = body.hostId ?? deps.config.DEFAULT_HOST_ID;
        const host = await deps.hosts.getHost(hostId);
        if (!host) {
          res.status(400).json({ error: 'Host not found' });
          return;
        }
        if (!deps.gateway.isHostConnected(hostId)) {
          res.status(503).json({ error: 'Host agent is offline' });
          return;
        }

        await deps.gateway.request(hostId, 'installation.ensureDirs', {});

        const response = await deps.gateway.request(
          hostId,
          'installation.import',
          {
            sourcePath: body.sourcePath,
            installationId: body.installationId,
          },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'Import failed' });
          return;
        }

        const imported = response.result as InstallationImportResult;
        const installation = await deps.installations.register({
          id: imported.id,
          hostId,
          gameVersion: imported.gameVersion,
          coopCommit: imported.coopCommit,
          layout: imported.layout,
          path: imported.path,
        });

        res.status(201).json({ installation, imported });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: err.flatten() });
          return;
        }
        next(err);
      }
    },
  );

  router.post(
    '/installations',
    auth,
    requirePermission('installations:write'),
    async (req, res, next) => {
      try {
        const body = registerSchema.parse(req.body);
        const hostId = body.hostId ?? deps.config.DEFAULT_HOST_ID;
        const host = await deps.hosts.getHost(hostId);
        if (!host) {
          res.status(400).json({ error: 'Host not found' });
          return;
        }

        if (deps.gateway.isHostConnected(hostId)) {
          await deps.gateway.request(hostId, 'installation.ensureDirs', {});
        }

        const installation = await deps.installations.register({
          id: body.id,
          hostId,
          gameVersion: body.gameVersion,
          coopCommit: body.coopCommit,
          layout: body.layout,
          path: body.path,
        });
        res.status(201).json({ installation });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: err.flatten() });
          return;
        }
        next(err);
      }
    },
  );

  return router;
}
