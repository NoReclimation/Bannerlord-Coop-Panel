import type { NextFunction, Request, Response } from 'express';
import {
  hasPermission,
  type AuthUser,
  type Permission,
} from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import { verifyAccessToken } from './tokens.js';
import type { UserRegistry } from '../services/user-registry.js';

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function requireAuth(
  config: ApiConfig,
  users: UserRegistry,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void (async () => {
      try {
        const header = req.headers.authorization;
        if (!header?.startsWith('Bearer ')) {
          res.status(401).json({ error: 'Missing bearer token' });
          return;
        }

        const token = header.slice('Bearer '.length).trim();
        const payload = verifyAccessToken(config, token);
        const user = await users.get(payload.sub);
        if (!user || user.disabled) {
          res.status(401).json({ error: 'Invalid or disabled user' });
          return;
        }

        (req as AuthedRequest).user = user;
        next();
      } catch {
        res.status(401).json({ error: 'Invalid or expired token' });
      }
    })();
  };
}

export function requirePermission(
  permission: Permission,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!hasPermission(user.role, permission)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
