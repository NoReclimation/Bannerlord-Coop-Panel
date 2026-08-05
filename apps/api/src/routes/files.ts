import { Router } from 'express';
import { z } from 'zod';
import type {
  FsListResult,
  FsReadResult,
  GameServerRecord,
} from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import type { AgentGateway } from '../agent/gateway.js';
import type { ServerRegistry } from '../services/server-registry.js';
import type { UserRegistry } from '../services/user-registry.js';
import { requireAuth, requirePermission } from '../auth/middleware.js';

type ServerCtx =
  | { ok: true; server: GameServerRecord }
  | { ok: false; error: string; status: number };

async function withServer(
  servers: ServerRegistry,
  gateway: AgentGateway,
  serverId: string,
): Promise<ServerCtx> {
  const server = await servers.get(serverId);
  if (!server) return { ok: false, error: 'Server not found', status: 404 };
  if (!gateway.isHostConnected(server.hostId)) {
    return { ok: false, error: 'Host agent is offline', status: 503 };
  }
  return { ok: true, server };
}

function paramId(value: string | string[] | undefined): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

export function createFilesRouter(deps: {
  config: ApiConfig;
  servers: ServerRegistry;
  gateway: AgentGateway;
  users: UserRegistry;
}): Router {
  const router = Router();
  const auth = requireAuth(deps.config, deps.users);
  const canRead = requirePermission('servers:read');
  const canWrite = requirePermission('servers:write');

  async function resolveServer(
    rawId: string | string[] | undefined,
  ): Promise<ServerCtx | { ok: false; error: string; status: 400 }> {
    const id = paramId(rawId);
    if (!id) return { ok: false, error: 'server id required', status: 400 };
    return withServer(deps.servers, deps.gateway, id);
  }

  router.get('/servers/:id/files', auth, canRead, async (req, res, next) => {
    try {
      const path = typeof req.query.path === 'string' ? req.query.path : '.';
      const ctx = await resolveServer(req.params.id);
      if (!ctx.ok) {
        res.status(ctx.status).json({ error: ctx.error });
        return;
      }
      const response = await deps.gateway.request(ctx.server.hostId, 'fs.list', {
        serverId: ctx.server.id,
        path,
      });
      if (!response.ok) {
        res.status(502).json({ error: response.error ?? 'list failed' });
        return;
      }
      res.json(response.result as FsListResult);
    } catch (err) {
      next(err);
    }
  });

  router.get(
    '/servers/:id/files/read',
    auth,
    canRead,
    async (req, res, next) => {
      try {
        const path = typeof req.query.path === 'string' ? req.query.path : '';
        if (!path) {
          res.status(400).json({ error: 'path required' });
          return;
        }
        const ctx = await resolveServer(req.params.id);
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }
        const response = await deps.gateway.request(
          ctx.server.hostId,
          'fs.read',
          { serverId: ctx.server.id, path },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'read failed' });
          return;
        }
        res.json(response.result as FsReadResult);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/servers/:id/files/download',
    auth,
    canRead,
    async (req, res, next) => {
      try {
        const path = typeof req.query.path === 'string' ? req.query.path : '';
        if (!path) {
          res.status(400).json({ error: 'path required' });
          return;
        }
        const ctx = await resolveServer(req.params.id);
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }
        const response = await deps.gateway.request(
          ctx.server.hostId,
          'fs.read',
          { serverId: ctx.server.id, path },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'download failed' });
          return;
        }
        const file = response.result as FsReadResult;
        const buf =
          file.encoding === 'base64'
            ? Buffer.from(file.content, 'base64')
            : Buffer.from(file.content, 'utf8');
        const name = path.split('/').pop() || 'download';
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${name.replace(/"/g, '')}"`,
        );
        res.send(buf);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/servers/:id/files/search',
    auth,
    canRead,
    async (req, res, next) => {
      try {
        const path = typeof req.query.path === 'string' ? req.query.path : '.';
        const query = typeof req.query.q === 'string' ? req.query.q : '';
        const ctx = await resolveServer(req.params.id);
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }
        const response = await deps.gateway.request(
          ctx.server.hostId,
          'fs.search',
          { serverId: ctx.server.id, path, query },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'search failed' });
          return;
        }
        res.json(response.result);
      } catch (err) {
        next(err);
      }
    },
  );

  const writeSchema = z.object({
    path: z.string().min(1),
    content: z.string(),
    encoding: z.enum(['utf8', 'base64']).default('utf8'),
  });

  router.put('/servers/:id/files', auth, canWrite, async (req, res, next) => {
    try {
      const body = writeSchema.parse(req.body);
      const ctx = await resolveServer(req.params.id);
      if (!ctx.ok) {
        res.status(ctx.status).json({ error: ctx.error });
        return;
      }
      const response = await deps.gateway.request(ctx.server.hostId, 'fs.write', {
        serverId: ctx.server.id,
        ...body,
      });
      if (!response.ok) {
        res.status(502).json({ error: response.error ?? 'write failed' });
        return;
      }
      res.json(response.result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: err.flatten() });
        return;
      }
      next(err);
    }
  });

  router.post(
    '/servers/:id/files/mkdir',
    auth,
    canWrite,
    async (req, res, next) => {
      try {
        const body = z.object({ path: z.string().min(1) }).parse(req.body);
        const ctx = await resolveServer(req.params.id);
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }
        const response = await deps.gateway.request(
          ctx.server.hostId,
          'fs.mkdir',
          { serverId: ctx.server.id, path: body.path },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'mkdir failed' });
          return;
        }
        res.status(201).json(response.result);
      } catch (err) {
        if (err instanceof z.ZodError) {
          res.status(400).json({ error: err.flatten() });
          return;
        }
        next(err);
      }
    },
  );

  const renameSchema = z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  });

  router.post(
    '/servers/:id/files/rename',
    auth,
    canWrite,
    async (req, res, next) => {
      try {
        const body = renameSchema.parse(req.body);
        const ctx = await resolveServer(req.params.id);
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }
        const response = await deps.gateway.request(
          ctx.server.hostId,
          'fs.rename',
          { serverId: ctx.server.id, ...body },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'rename failed' });
          return;
        }
        res.json(response.result);
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
    '/servers/:id/files/move',
    auth,
    canWrite,
    async (req, res, next) => {
      try {
        const body = renameSchema.parse(req.body);
        const ctx = await resolveServer(req.params.id);
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }
        const response = await deps.gateway.request(
          ctx.server.hostId,
          'fs.move',
          { serverId: ctx.server.id, ...body },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'move failed' });
          return;
        }
        res.json(response.result);
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
    '/servers/:id/files',
    auth,
    canWrite,
    async (req, res, next) => {
      try {
        const path = typeof req.query.path === 'string' ? req.query.path : '';
        if (!path) {
          res.status(400).json({ error: 'path required' });
          return;
        }
        const ctx = await resolveServer(req.params.id);
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }
        const response = await deps.gateway.request(
          ctx.server.hostId,
          'fs.delete',
          { serverId: ctx.server.id, path },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'delete failed' });
          return;
        }
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/servers/:id/files/extract',
    auth,
    canWrite,
    async (req, res, next) => {
      try {
        const body = z
          .object({ path: z.string().min(1), dest: z.string().optional() })
          .parse(req.body);
        const ctx = await resolveServer(req.params.id);
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }
        const response = await deps.gateway.request(
          ctx.server.hostId,
          'fs.extractZip',
          { serverId: ctx.server.id, ...body },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'extract failed' });
          return;
        }
        res.json(response.result);
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
    '/servers/:id/files/compress',
    auth,
    canWrite,
    async (req, res, next) => {
      try {
        const body = z
          .object({
            paths: z.array(z.string().min(1)).min(1),
            dest: z.string().min(1),
          })
          .parse(req.body);
        const ctx = await resolveServer(req.params.id);
        if (!ctx.ok) {
          res.status(ctx.status).json({ error: ctx.error });
          return;
        }
        const response = await deps.gateway.request(
          ctx.server.hostId,
          'fs.compress',
          { serverId: ctx.server.id, ...body },
        );
        if (!response.ok) {
          res.status(502).json({ error: response.error ?? 'compress failed' });
          return;
        }
        res.json(response.result);
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
