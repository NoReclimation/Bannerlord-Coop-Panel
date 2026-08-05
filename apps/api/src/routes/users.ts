import { Router } from 'express';
import { z } from 'zod';
import type { ApiConfig } from '../config.js';
import {
  requireAuth,
  requirePermission,
  type AuthedRequest,
} from '../auth/middleware.js';
import type { UserRegistry } from '../services/user-registry.js';
import type { RefreshTokenStore } from '../services/refresh-token-store.js';

const createUserSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
  role: z.enum(['admin', 'moderator', 'viewer']),
  displayName: z.string().max(128).optional(),
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'moderator', 'viewer']).optional(),
  displayName: z.string().max(128).nullable().optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});

export function createUsersRouter(deps: {
  config: ApiConfig;
  users: UserRegistry;
  refreshTokens: RefreshTokenStore;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);
  const manage = requirePermission('users:manage');

  router.get('/users', auth, manage, async (_req, res, next) => {
    try {
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

  return router;
}
