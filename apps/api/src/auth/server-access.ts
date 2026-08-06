import type { NextFunction, Request, Response } from 'express';
import { seesAllServers, type AuthUser } from '@bannerlord-panel/shared';
import type { UserServerRegistry } from '../services/user-server-registry.js';
import type { AuthedRequest } from './middleware.js';

export async function userCanAccessServer(
  user: AuthUser,
  serverId: string,
  assignments: UserServerRegistry,
): Promise<boolean> {
  if (seesAllServers(user.role)) return true;
  return assignments.isAssigned(user.id, serverId);
}

/** 404 (not 403) when a user is not assigned — avoids leaking server IDs. */
export function requireAssignedServerAccess(
  assignments: UserServerRegistry,
  paramName = 'id',
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void (async () => {
      try {
        const user = (req as AuthedRequest).user;
        if (!user) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        const serverId = req.params[paramName];
        if (typeof serverId !== 'string' || !serverId) {
          res.status(400).json({ error: 'server id required' });
          return;
        }
        if (await userCanAccessServer(user, serverId, assignments)) {
          next();
          return;
        }
        res.status(404).json({ error: 'Server not found' });
      } catch (err) {
        next(err);
      }
    })();
  };
}
