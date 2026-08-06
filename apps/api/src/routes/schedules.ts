import { Router } from 'express';
import { z } from 'zod';
import type { ApiConfig } from '../config.js';
import type { ServerRegistry } from '../services/server-registry.js';
import type { ScheduleRegistry } from '../services/schedule-registry.js';
import type { ScheduleRunner } from '../services/schedule-runner.js';
import type { UserRegistry } from '../services/user-registry.js';
import type { UserServerRegistry } from '../services/user-server-registry.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';
import { requireAssignedServerAccess } from '../auth/server-access.js';

const createSchema = z.object({
  name: z.string().min(1).max(128),
  enabled: z.boolean().optional(),
  scheduleKind: z.enum(['cron', 'interval', 'once']),
  cronExpr: z.string().max(128).nullable().optional(),
  intervalMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  runAt: z.string().min(1).nullable().optional(),
  action: z.enum(['restart', 'start', 'stop', 'command', 'backup']),
  payload: z
    .object({
      command: z.string().max(2000).optional(),
    })
    .optional(),
  countdownMinutes: z.array(z.number().int().min(1).max(1440)).max(12).optional(),
  countdownMessage: z.string().max(500).optional(),
});

const updateSchema = createSchema.partial();

function paramId(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

export function createSchedulesRouter(deps: {
  config: ApiConfig;
  servers: ServerRegistry;
  schedules: ScheduleRegistry;
  scheduleRunner: ScheduleRunner;
  users: UserRegistry;
  userServers: UserServerRegistry;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);
  const canRead = requirePermission('servers:read');
  const canControl = requirePermission('servers:control');
  const serverAccess = requireAssignedServerAccess(deps.userServers);

  router.get(
    '/servers/:id/schedules',
    auth,
    canRead,
    serverAccess,
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
        const schedules = await deps.schedules.listByServer(serverId);
        res.json({ schedules });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/servers/:id/schedules',
    auth,
    canControl,
    serverAccess,
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
        const body = createSchema.parse(req.body);
        const schedule = await deps.schedules.create(serverId, body);
        res.status(201).json({ schedule });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: err.flatten() });
          return;
        }
        if (err instanceof Error) {
          res.status(400).json({ error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  router.patch(
    '/servers/:id/schedules/:taskId',
    auth,
    canControl,
    serverAccess,
    async (req, res, next) => {
      try {
        const serverId = paramId(req.params.id);
        const taskId = paramId(req.params.taskId);
        if (!serverId || !taskId) {
          res.status(400).json({ error: 'ids required' });
          return;
        }
        const existing = await deps.schedules.get(taskId);
        if (!existing || existing.serverId !== serverId) {
          res.status(404).json({ error: 'Schedule not found' });
          return;
        }
        const body = updateSchema.parse(req.body);
        const schedule = await deps.schedules.update(taskId, body);
        res.json({ schedule });
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: err.flatten() });
          return;
        }
        if (err instanceof Error) {
          res.status(400).json({ error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  router.delete(
    '/servers/:id/schedules/:taskId',
    auth,
    canControl,
    serverAccess,
    async (req, res, next) => {
      try {
        const serverId = paramId(req.params.id);
        const taskId = paramId(req.params.taskId);
        if (!serverId || !taskId) {
          res.status(400).json({ error: 'ids required' });
          return;
        }
        const existing = await deps.schedules.get(taskId);
        if (!existing || existing.serverId !== serverId) {
          res.status(404).json({ error: 'Schedule not found' });
          return;
        }
        await deps.schedules.delete(taskId);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/servers/:id/schedules/:taskId/run',
    auth,
    canControl,
    serverAccess,
    async (req, res, next) => {
      try {
        const serverId = paramId(req.params.id);
        const taskId = paramId(req.params.taskId);
        if (!serverId || !taskId) {
          res.status(400).json({ error: 'ids required' });
          return;
        }
        const existing = await deps.schedules.get(taskId);
        if (!existing || existing.serverId !== serverId) {
          res.status(404).json({ error: 'Schedule not found' });
          return;
        }
        const schedule = await deps.scheduleRunner.runNow(taskId);
        res.json({ schedule });
      } catch (err) {
        if (err instanceof Error) {
          res.status(502).json({ error: err.message });
          return;
        }
        next(err);
      }
    },
  );

  return router;
}
