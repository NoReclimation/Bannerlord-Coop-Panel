import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { ServerCreateResult } from '@bannerlord-panel/shared';
import type { AgentGateway } from '../agent/gateway.js';
import type { HostRegistry } from '../services/host-registry.js';
import type { InstallationRegistry } from '../services/installation-registry.js';
import type { PortAllocator } from '../services/port-allocator.js';
import type { ServerRegistry } from '../services/server-registry.js';
import type { UserRegistry } from '../services/user-registry.js';
import type { ApiConfig } from '../config.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import type { PlayerCountStore } from '../services/player-count-store.js';
import type { BrowserGateway } from '../agent/browser-gateway.js';
import type { PlaytimeRegistry } from '../services/playtime-registry.js';
import type { DeleteRequestRegistry } from '../services/delete-request-registry.js';
import type { AuthedRequest } from '../auth/middleware.js';

const createServerSchema = z.object({
  name: z.string().min(1).max(64),
  hostId: z.string().uuid().optional(),
  installationId: z.string().min(1),
  saveName: z.string().min(1).max(128).optional(),
  password: z.string().max(128).optional(),
  autosaveMinutes: z.number().int().min(0).max(1440).optional(),
  logFile: z.boolean().optional(),
  start: z.boolean().optional(),
});

const analyticsRangeSchema = z.enum(['today', 'yesterday', '7d', '30d']);

export function createServersRouter(deps: {
  config: ApiConfig;
  hosts: HostRegistry;
  installations: InstallationRegistry;
  servers: ServerRegistry;
  ports: PortAllocator;
  gateway: AgentGateway;
  users: UserRegistry;
  playerCounts: PlayerCountStore;
  browserGateway: BrowserGateway;
  playtime: PlaytimeRegistry;
  deleteRequests: DeleteRequestRegistry;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);
  const canRead = requirePermission('servers:read');
  const canWrite = requirePermission('servers:write');
  const canCreate = requirePermission('servers:create');
  const canDelete = requirePermission('servers:delete');
  const canDeleteRequest = requirePermission('servers:delete-request');
  const canControl = requirePermission('servers:control');
  const canKill = requirePermission('servers:kill');

  router.get('/servers', auth, canRead, async (req, res, next) => {
    try {
      const hostId =
        typeof req.query.hostId === 'string' ? req.query.hostId : undefined;
      const list = await deps.servers.list(hostId);
      res.json({ servers: deps.playerCounts.attachAll(list) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/servers/:id/analytics', auth, canRead, async (req, res, next) => {
    try {
      const server = await deps.servers.get(req.params.id);
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      if (deps.gateway.isHostConnected(server.hostId)) {
        try {
          const saveRes = await deps.gateway.request(
            server.hostId,
            'server.readSavePlayers',
            { serverId: server.id, saveName: server.saveName },
          );
          if (saveRes.ok && saveRes.result) {
            const result = saveRes.result as {
              players?: import('@bannerlord-panel/shared').SavePlayerIdentity[];
            };
            deps.playtime.setSavePlayers(server.id, result.players ?? []);
          }
        } catch {
          // analytics still works without save.json
        }
      }
      const range = analyticsRangeSchema.parse(req.query.range ?? '7d');
      const analytics = await deps.playtime.getAnalytics(server.id, range);
      res.json({ analytics });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      next(err);
    }
  });

  router.get('/servers/:id', auth, canRead, async (req, res, next) => {
    try {
      const server = await deps.servers.get(req.params.id);
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      res.json({ server: deps.playerCounts.attach(server) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/servers', auth, canCreate, async (req, res, next) => {
    try {
      const body = createServerSchema.parse(req.body);
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

      const installation = await deps.installations.get(body.installationId);
      if (!installation || installation.hostId !== hostId) {
        res.status(400).json({ error: 'Installation not found on host' });
        return;
      }

      const { gamePort, enginePort } = await deps.ports.allocate(hostId);
      const serverId = randomUUID();

      const saveName = body.saveName ?? 'saveauto1';
      const password = body.password ?? '';
      const autosaveMinutes = body.autosaveMinutes ?? 5;
      const logFile = body.logFile ?? true;

      let server = await deps.servers.create({
        id: serverId,
        name: body.name,
        hostId,
        installationId: installation.id,
        gamePort,
        enginePort,
        saveName,
        password,
        autosaveMinutes,
        logFile,
      });

      const createRes = await deps.gateway.request(hostId, 'server.create', {
        serverId,
        name: body.name,
        installationId: installation.id,
        installationPath: installation.path,
        gamePort,
        enginePort,
        saveName,
        password,
        autosaveMinutes,
        logFile,
      });

      if (!createRes.ok) {
        await deps.servers.updateStatus(serverId, 'error', {
          errorMessage: createRes.error ?? 'create failed',
        });
        await deps.servers.delete(serverId);
        res.status(502).json({ error: createRes.error ?? 'Agent create failed' });
        return;
      }

      const result = createRes.result as ServerCreateResult;
      server =
        (await deps.servers.updateStatus(serverId, 'stopped', {
          containerId: result.containerId,
          containerName: result.containerName,
          errorMessage: null,
        })) ?? server;

      if (body.start) {
        await deps.servers.updateStatus(serverId, 'starting');
        const startRes = await deps.gateway.request(hostId, 'server.start', {
          serverId,
          gamePort,
          enginePort,
        });
        if (startRes.ok) {
          server =
            (await deps.servers.updateStatus(serverId, 'running', {
              lastRestartAt: true,
              errorMessage: null,
            })) ?? server;
        } else {
          server =
            (await deps.servers.updateStatus(serverId, 'error', {
              errorMessage: startRes.error ?? 'start failed',
            })) ?? server;
        }
      }

      res.status(201).json({ server });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      next(err);
    }
  });

  async function lifecycle(
    id: string,
    action: 'server.start' | 'server.stop' | 'server.restart' | 'server.kill',
    res: import('express').Response,
    next: import('express').NextFunction,
  ): Promise<void> {
    try {
      const server = await deps.servers.get(id);
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      if (!deps.gateway.isHostConnected(server.hostId)) {
        res.status(503).json({ error: 'Host agent is offline' });
        return;
      }

      const pendingStatus =
        action === 'server.start' || action === 'server.restart'
          ? 'starting'
          : 'stopping';
      await deps.servers.updateStatus(id, pendingStatus);

      const response = await deps.gateway.request(server.hostId, action, {
        serverId: id,
        ...(action === 'server.start' || action === 'server.restart'
          ? {
              gamePort: server.gamePort,
              enginePort: server.enginePort,
            }
          : {}),
      });

      if (!response.ok) {
        await deps.servers.updateStatus(id, 'error', {
          errorMessage: response.error ?? 'command failed',
        });
        res.status(502).json({ error: response.error ?? 'Agent command failed' });
        return;
      }

      const nextStatus =
        action === 'server.start' || action === 'server.restart'
          ? 'running'
          : 'stopped';
      if (nextStatus === 'stopped') {
        deps.browserGateway.clearPlayerCount(id);
      }
      const updated = await deps.servers.updateStatus(id, nextStatus, {
        lastRestartAt: action === 'server.start' || action === 'server.restart',
        errorMessage: null,
      });
      res.json({
        server: updated ? deps.playerCounts.attach(updated) : updated,
      });
    } catch (err) {
      next(err);
    }
  }

  router.post('/servers/:id/start', auth, canControl, (req, res, next) => {
    void lifecycle(req.params.id, 'server.start', res, next);
  });
  router.post('/servers/:id/stop', auth, canControl, (req, res, next) => {
    void lifecycle(req.params.id, 'server.stop', res, next);
  });
  router.post('/servers/:id/restart', auth, canControl, (req, res, next) => {
    void lifecycle(req.params.id, 'server.restart', res, next);
  });
  router.post('/servers/:id/kill', auth, canKill, (req, res, next) => {
    void lifecycle(req.params.id, 'server.kill', res, next);
  });

  async function deleteServerInstance(serverId: string): Promise<{
    ok: boolean;
    status: number;
    error?: string;
  }> {
    const server = await deps.servers.get(serverId);
    if (!server) return { ok: false, status: 404, error: 'Server not found' };

    if (deps.gateway.isHostConnected(server.hostId)) {
      const del = await deps.gateway.request(server.hostId, 'server.delete', {
        serverId: server.id,
      });
      if (!del.ok) {
        return {
          ok: false,
          status: 502,
          error: del.error ?? 'Agent delete failed',
        };
      }
    }

    await deps.playtime.closeAllForServer(server.id);
    await deps.servers.delete(server.id);
    deps.browserGateway.clearPlayerCount(server.id);
    return { ok: true, status: 204 };
  }

  router.post(
    '/servers/:id/delete-request',
    auth,
    canDeleteRequest,
    async (req, res, next) => {
      try {
        const me = (req as AuthedRequest).user!;
        const server = await deps.servers.get(req.params.id);
        if (!server) {
          res.status(404).json({ error: 'Server not found' });
          return;
        }
        const { created, request } = await deps.deleteRequests.create(
          server.id,
          me.id,
        );
        res.status(created ? 201 : 200).json({ request });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/delete-requests', auth, canDelete, async (req, res, next) => {
    try {
      const status =
        req.query.status === 'approved' || req.query.status === 'rejected'
          ? req.query.status
          : 'pending';
      const requests = await deps.deleteRequests.list(status);
      res.json({ requests });
    } catch (err) {
      next(err);
    }
  });

  router.get(
    '/delete-requests/pending-server-ids',
    auth,
    canRead,
    async (_req, res, next) => {
      try {
        const serverIds = await deps.deleteRequests.listPendingServerIds();
        res.json({ serverIds });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/delete-requests/:id/approve',
    auth,
    canDelete,
    async (req, res, next) => {
      try {
        const me = (req as AuthedRequest).user!;
        const pending = await deps.deleteRequests.get(req.params.id);
        if (!pending || pending.status !== 'pending' || !pending.serverId) {
          res.status(404).json({ error: 'Delete request not found' });
          return;
        }
        const request = await deps.deleteRequests.approve(pending.id, me.id);
        const result = await deleteServerInstance(pending.serverId);
        if (!result.ok) {
          res.status(result.status).json({ error: result.error });
          return;
        }
        res.json({ request });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/delete-requests/:id/reject',
    auth,
    canDelete,
    async (req, res, next) => {
      try {
        const me = (req as AuthedRequest).user!;
        const request = await deps.deleteRequests.reject(
          req.params.id,
          me.id,
          typeof req.body?.note === 'string' ? req.body.note : undefined,
        );
        if (!request) {
          res.status(404).json({ error: 'Delete request not found' });
          return;
        }
        res.json({ request });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/servers/:id', auth, canDelete, async (req, res, next) => {
    try {
      const result = await deleteServerInstance(req.params.id);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  const configSchema = z.object({
    process: z.object({
      saveName: z.string().min(1).max(128),
      autosaveMinutes: z.number().int().min(0).max(1440),
      password: z.string().max(128),
      logFile: z.boolean(),
    }),
    modConfig: z.object({
      difficulty: z.record(z.unknown()),
      modOptions: z.record(z.unknown()),
    }),
  });

  router.get('/servers/:id/config', auth, canRead, async (req, res, next) => {
    try {
      const server = await deps.servers.get(req.params.id);
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      if (!deps.gateway.isHostConnected(server.hostId)) {
        res.status(503).json({ error: 'Host agent is offline' });
        return;
      }
      const response = await deps.gateway.request(
        server.hostId,
        'server.getConfig',
        { serverId: server.id, gamePort: server.gamePort },
      );
      if (!response.ok) {
        res.status(502).json({ error: response.error ?? 'Failed to load config' });
        return;
      }
      res.json({ config: response.result });
    } catch (err) {
      next(err);
    }
  });

  router.put('/servers/:id/config', auth, canWrite, async (req, res, next) => {
    try {
      const body = configSchema.parse(req.body);
      const server = await deps.servers.get(req.params.id);
      if (!server) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      if (!deps.gateway.isHostConnected(server.hostId)) {
        res.status(503).json({ error: 'Host agent is offline' });
        return;
      }

      const response = await deps.gateway.request(
        server.hostId,
        'server.putConfig',
        {
          serverId: server.id,
          gamePort: server.gamePort,
          process: body.process,
          modConfig: body.modConfig,
        },
      );
      if (!response.ok) {
        res.status(502).json({ error: response.error ?? 'Failed to save config' });
        return;
      }

      const updated = await deps.servers.updateProcess(server.id, body.process);
      res.json({ config: response.result, server: updated });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      next(err);
    }
  });

  return router;
}
