import { Router } from 'express';
import { z } from 'zod';
import { hasPermission } from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import {
  requireAuth,
  requirePermission,
  type AuthedRequest,
} from '../auth/middleware.js';
import type { UserRegistry } from '../services/user-registry.js';
import type { RefreshTokenStore } from '../services/refresh-token-store.js';
import type { UserServerRegistry } from '../services/user-server-registry.js';
import type { ServerRegistry } from '../services/server-registry.js';

const createUserSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
  role: z.enum(['admin', 'moderator', 'user']),
  displayName: z.string().max(128).optional(),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'moderator', 'user']).optional(),
  displayName: z.string().max(128).nullable().optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});

const assignServersSchema = z.object({
  serverIds: z.array(z.string().uuid()),
});

export function createUsersRouter(deps: {
  config: ApiConfig;
  users: UserRegistry;
  refreshTokens: RefreshTokenStore;
  userServers: UserServerRegistry;
  servers: ServerRegistry;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);
  const manage = requirePermission('users:manage');
  const assign = requirePermission('servers:assign');

  router.get('/users', auth, async (req, res, next) => {
    try {
      const me = (req as AuthedRequest).user!;
      if (
        !hasPermission(me.role, 'users:manage') &&
        !hasPermission(me.role, 'servers:assign')
      ) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const users = await deps.users.list();
      res.json({ users });
    } catch (err) {
      next(err);
    }
  });

  router.post('/users', auth, manage, async (req, res, next) => {
    try {
      const body = createUserSchema.parse(req.body);
      const user = await deps.users.create(body);
      res.status(201).json({ user });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      next(err);
    }
  });

  router.patch('/users/:id', auth, manage, async (req, res, next) => {
    try {
      const body = updateUserSchema.parse(req.body);
      const user = await deps.users.update(req.params.id, body);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (body.password || body.disabled === true) {
        await deps.refreshTokens.revokeAllForUser(user.id);
      }
      res.json({ user });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      next(err);
    }
  });

  router.delete('/users/:id', auth, manage, async (req, res, next) => {
    try {
      const me = (req as AuthedRequest).user!;
      if (me.id === req.params.id) {
        res.status(400).json({ error: 'Cannot delete your own account' });
        return;
      }
      const ok = await deps.users.delete(req.params.id);
      if (!ok) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      await deps.refreshTokens.revokeAllForUser(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.get('/users/:id/servers', auth, assign, async (req, res, next) => {
    try {
      const user = await deps.users.get(req.params.id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const serverIds = await deps.userServers.listServerIdsForUser(user.id);
      res.json({ userId: user.id, serverIds });
    } catch (err) {
      next(err);
    }
  });

  router.put('/users/:id/servers', auth, assign, async (req, res, next) => {
    try {
      const me = (req as AuthedRequest).user!;
      const user = await deps.users.get(req.params.id);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      if (user.role !== 'user') {
        res.status(400).json({
          error: 'Server assignments only apply to users with the user role',
        });
        return;
      }
      const body = assignServersSchema.parse(req.body);
      const validIds: string[] = [];
      for (const serverId of [...new Set(body.serverIds)]) {
        const server = await deps.servers.get(serverId);
        if (server) validIds.push(serverId);
      }
      const serverIds = await deps.userServers.setServersForUser(
        user.id,
        validIds,
        me.id,
      );
      res.json({ userId: user.id, serverIds });
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
