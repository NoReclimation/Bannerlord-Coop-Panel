import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type {
  BackupRef,
  ServerBackupReadResult,
} from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import type { AgentGateway } from '../agent/gateway.js';
import type { ServerRegistry } from '../services/server-registry.js';
import type { BackupRegistry } from '../services/backup-registry.js';
import type { UserRegistry } from '../services/user-registry.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

function paramId(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

async function pruneRetention(
  backups: BackupRegistry,
  gateway: AgentGateway,
  serverId: string,
  hostId: string,
): Promise<void> {
  const retention = await backups.getRetentionCount();
  const overflow = await backups.listOverflow(serverId, retention);
  for (const old of overflow) {
    if (gateway.isHostConnected(hostId)) {
      await gateway.request(hostId, 'server.deleteBackup', {
        serverId,
        backupId: old.id,
      });
    }
    await backups.delete(old.id);
  }
}

export async function createServerBackup(deps: {
  servers: ServerRegistry;
  backups: BackupRegistry;
  gateway: AgentGateway;
  serverId: string;
  note?: string;
}): Promise<BackupRef> {
  const server = await deps.servers.get(deps.serverId);
  if (!server) throw new Error('Server not found');
  if (!deps.gateway.isHostConnected(server.hostId)) {
    throw new Error('Host agent is offline');
  }

  const backupId = randomUUID();
  const response = await deps.gateway.request(
    server.hostId,
    'server.backup',
    {
      serverId: server.id,
      backupId,
      note: deps.note,
    },
  );
  if (!response.ok) {
    throw new Error(response.error ?? 'Backup failed');
  }

  const result = response.result as BackupRef;
  const record = await deps.backups.create({
    id: backupId,
    serverId: server.id,
    relativePath:
      result.relativePath ?? `backups/${server.id}/${backupId}.zip`,
    sizeBytes: result.sizeBytes,
    note: deps.note ?? result.note ?? null,
    createdAt: result.createdAt,
  });

  await pruneRetention(
    deps.backups,
    deps.gateway,
    server.id,
    server.hostId,
  );

  return record;
}

export function createBackupsRouter(deps: {
  config: ApiConfig;
  servers: ServerRegistry;
  backups: BackupRegistry;
  gateway: AgentGateway;
  users: UserRegistry;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);
  const canRead = requirePermission('servers:read');
  const canWrite = requirePermission('servers:write');
  const canControl = requirePermission('servers:control');

  router.get(
    '/servers/:id/backups',
    auth,
    canRead,
    async (req, res, next) => {
      try {
        const serverId = paramId(req.params.id);
        if (!serverId) {
          res.status(400).json({ error: 'server id required' });
          return;
        }
        const server = await deps.servers.get(serverId);
        if (!server) {
          res.status(404).json({ error: 'Server not found' });
          return;
        }
        const backups = await deps.backups.listByServer(serverId);
        const retentionCount = await deps.backups.getRetentionCount();
        res.json({ backups, retentionCount });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/servers/:id/backups',
    auth,
    canControl,
    async (req, res, next) => {
      try {
        const serverId = paramId(req.params.id);
        if (!serverId) {
          res.status(400).json({ error: 'server id required' });
          return;
        }
        const body = z
          .object({ note: z.string().max(500).optional() })
          .parse(req.body ?? {});
        const backup = await createServerBackup({
          servers: deps.servers,
          backups: deps.backups,
          gateway: deps.gateway,
          serverId,
          note: body.note,
        });
        res.status(201).json({ backup });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: err.flatten() });
          return;
        }
        if (err instanceof Error) {
          const status =
            err.message === 'Server not found'
              ? 404
              : err.message.includes('offline')
                ? 503
                : 502;
          res.status(status).json({ error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  router.post(
    '/servers/:id/backups/:backupId/restore',
    auth,
    canWrite,
    async (req, res, next) => {
      try {
        const serverId = paramId(req.params.id);
        const backupId = paramId(req.params.backupId);
        if (!serverId || !backupId) {
          res.status(400).json({ error: 'ids required' });
          return;
        }
        const body = z
          .object({ startAfter: z.boolean().optional() })
          .parse(req.body ?? {});

        const server = await deps.servers.get(serverId);
        if (!server) {
          res.status(404).json({ error: 'Server not found' });
          return;
        }
        const backup = await deps.backups.get(backupId);
        if (!backup || backup.serverId !== serverId) {
          res.status(404).json({ error: 'Backup not found' });
          return;
        }
        if (!deps.gateway.isHostConnected(server.hostId)) {
          res.status(503).json({ error: 'Host agent is offline' });
          return;
        }

        const wasRunning = server.status === 'running';
        if (wasRunning) {
          await deps.servers.updateStatus(serverId, 'stopping');
          const stop = await deps.gateway.request(
            server.hostId,
            'server.stop',
            { serverId },
          );
          if (!stop.ok) {
            await deps.servers.updateStatus(serverId, 'error', {
              errorMessage: stop.error ?? 'stop before restore failed',
            });
            res.status(502).json({ error: stop.error ?? 'Stop failed' });
            return;
          }
          await deps.servers.updateStatus(serverId, 'stopped');
        }

        const restore = await deps.gateway.request(
          server.hostId,
          'server.restoreBackup',
          { serverId, backupId },
        );
        if (!restore.ok) {
          res.status(502).json({ error: restore.error ?? 'Restore failed' });
          return;
        }

        let updated = await deps.servers.get(serverId);
        if (body.startAfter ?? wasRunning) {
          await deps.servers.updateStatus(serverId, 'starting');
          const start = await deps.gateway.request(
            server.hostId,
            'server.start',
            {
              serverId,
              gamePort: server.gamePort,
              enginePort: server.enginePort,
            },
          );
          if (!start.ok) {
            await deps.servers.updateStatus(serverId, 'error', {
              errorMessage: start.error ?? 'start after restore failed',
            });
            res.status(502).json({
              error: start.error ?? 'Restored but start failed',
              backup,
            });
            return;
          }
          updated = await deps.servers.updateStatus(serverId, 'running', {
            errorMessage: null,
          });
        }

        res.json({ backup, server: updated });
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
    '/servers/:id/backups/:backupId',
    auth,
    canWrite,
    async (req, res, next) => {
      try {
        const serverId = paramId(req.params.id);
        const backupId = paramId(req.params.backupId);
        if (!serverId || !backupId) {
          res.status(400).json({ error: 'ids required' });
          return;
        }
        const server = await deps.servers.get(serverId);
        if (!server) {
          res.status(404).json({ error: 'Server not found' });
          return;
        }
        const backup = await deps.backups.get(backupId);
        if (!backup || backup.serverId !== serverId) {
          res.status(404).json({ error: 'Backup not found' });
          return;
        }

        if (deps.gateway.isHostConnected(server.hostId)) {
          const del = await deps.gateway.request(
            server.hostId,
            'server.deleteBackup',
            { serverId, backupId },
          );
          if (!del.ok) {
            res.status(502).json({ error: del.error ?? 'Delete failed' });
            return;
          }
        }

        await deps.backups.delete(backupId);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/servers/:id/backups/:backupId/download',
    auth,
    canRead,
    async (req, res, next) => {
      try {
        const serverId = paramId(req.params.id);
        const backupId = paramId(req.params.backupId);
        if (!serverId || !backupId) {
          res.status(400).json({ error: 'server id required' });
          return;
        }
        const server = await deps.servers.get(serverId);
        if (!server) {
          res.status(404).json({ error: 'Server not found' });
          return;
        }
        const backup = await deps.backups.get(backupId);
        if (!backup || backup.serverId !== serverId) {
          res.status(404).json({ error: 'Backup not found' });
          return;
        }
        if (!deps.gateway.isHostConnected(server.hostId)) {
          res.status(503).json({ error: 'Host agent is offline' });
          return;
        }

        const response = await deps.gateway.request(
          server.hostId,
          'server.readBackup',
          { serverId, backupId },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'Download failed' });
          return;
        }
        const file = response.result as ServerBackupReadResult;
        if (file.truncated) {
          res.status(413).json({
            error: `Backup exceeds download limit (${file.size} bytes)`,
          });
          return;
        }
        const buf = Buffer.from(file.content, 'base64');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="backup-${backupId}.zip"`,
        );
        res.send(buf);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
