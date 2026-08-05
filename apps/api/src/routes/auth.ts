import { Router } from 'express';
import { z } from 'zod';
import { permissionsFor } from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import { verifyPassword } from '../auth/passwords.js';
import { signAccessToken } from '../auth/tokens.js';
import {
  requireAuth,
  type AuthedRequest,
} from '../auth/middleware.js';
import type { UserRegistry } from '../services/user-registry.js';
import type { RefreshTokenStore } from '../services/refresh-token-store.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export function createAuthRouter(deps: {
  config: ApiConfig;
  users: UserRegistry;
  refreshTokens: RefreshTokenStore;
}): Router {
  const router = Router();

  router.post('/auth/login', async (req, res, next) => {
    try {
      const body = loginSchema.parse(req.body);
      const found = await deps.users.findByUsername(body.username);
      if (!found || found.user.disabled) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const ok = await verifyPassword(body.password, found.passwordHash);
      if (!ok) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const accessToken = signAccessToken(deps.config, {
        sub: found.user.id,
        username: found.user.username,
        role: found.user.role,
      });

      const refresh = await deps.refreshTokens.issue({
        userId: found.user.id,
        ttl: deps.config.JWT_REFRESH_TTL,
        userAgent: req.get('user-agent') ?? undefined,
        ip: req.ip,
      });

      res.json({
        accessToken,
        refreshToken: refresh.token,
        expiresAt: refresh.expiresAt.toISOString(),
        user: found.user,
        permissions: permissionsFor(found.user.role),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      next(err);
    }
  });

  router.post('/auth/refresh', async (req, res, next) => {
    try {
      const body = refreshSchema.parse(req.body);
      const consumed = await deps.refreshTokens.consume(body.refreshToken);
      if (!consumed) {
        res.status(401).json({ error: 'Invalid refresh token' });
        return;
      }

      const user = await deps.users.get(consumed.userId);
      if (!user || user.disabled) {
        res.status(401).json({ error: 'Invalid refresh token' });
        return;
      }

      const accessToken = signAccessToken(deps.config, {
        sub: user.id,
        username: user.username,
        role: user.role,
      });

      const refresh = await deps.refreshTokens.issue({
        userId: user.id,
        ttl: deps.config.JWT_REFRESH_TTL,
        userAgent: req.get('user-agent') ?? undefined,
        ip: req.ip,
      });

      res.json({
        accessToken,
        refreshToken: refresh.token,
        expiresAt: refresh.expiresAt.toISOString(),
        user,
        permissions: permissionsFor(user.role),
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      next(err);
    }
  });

  router.post(
    '/auth/logout',
    requireAuth(deps.config, deps.users),
    async (req, res, next) => {
      try {
        const body = refreshSchema.partial().parse(req.body ?? {});
        if (body.refreshToken) {
          await deps.refreshTokens.revoke(body.refreshToken);
        } else {
          const user = (req as AuthedRequest).user!;
          await deps.refreshTokens.revokeAllForUser(user.id);
        }
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/auth/me',
    requireAuth(deps.config, deps.users),
    (req, res) => {
      const user = (req as AuthedRequest).user!;
      res.json({
        user,
        permissions: permissionsFor(user.role),
      });
    },
  );

  return router;
}
