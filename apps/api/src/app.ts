import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors from 'cors';
import type { Pool } from 'pg';
import type { ApiConfig } from './config.js';
import { parseCorsOrigins } from './config.js';
import type { HostRegistry } from './services/host-registry.js';
import type { InstallationRegistry } from './services/installation-registry.js';
import type { PortAllocator } from './services/port-allocator.js';
import type { ServerRegistry } from './services/server-registry.js';
import type { UserRegistry } from './services/user-registry.js';
import type { RefreshTokenStore } from './services/refresh-token-store.js';
import type { AgentGateway } from './agent/gateway.js';
import { createHealthRouter } from './routes/health.js';
import { createHostsRouter } from './routes/hosts.js';
import { createSettingsRouter } from './routes/settings.js';
import { createServersRouter } from './routes/servers.js';
import { createInstallationsRouter } from './routes/installations.js';
import { createAuthRouter } from './routes/auth.js';
import { createUsersRouter } from './routes/users.js';
import { createFilesRouter } from './routes/files.js';
import { createSchedulesRouter } from './routes/schedules.js';
import { createBackupsRouter } from './routes/backups.js';
import { createModpacksRouter } from './routes/modpacks.js';
import type { ScheduleRegistry } from './services/schedule-registry.js';
import type { ScheduleRunner } from './services/schedule-runner.js';
import type { BackupRegistry } from './services/backup-registry.js';
import type { PlayerCountStore } from './services/player-count-store.js';
import type { BrowserGateway } from './agent/browser-gateway.js';
import type { PlaytimeRegistry } from './services/playtime-registry.js';
import type { DeleteRequestRegistry } from './services/delete-request-registry.js';
import type { UserServerRegistry } from './services/user-server-registry.js';

export interface AppDeps {
  config: ApiConfig;
  pool: Pool;
  hosts: HostRegistry;
  installations: InstallationRegistry;
  servers: ServerRegistry;
  ports: PortAllocator;
  users: UserRegistry;
  refreshTokens: RefreshTokenStore;
  gateway: AgentGateway;
  schedules: ScheduleRegistry;
  scheduleRunner: ScheduleRunner;
  backups: BackupRegistry;
  playerCounts: PlayerCountStore;
  browserGateway: BrowserGateway;
  playtime: PlaytimeRegistry;
  deleteRequests: DeleteRequestRegistry;
  userServers: UserServerRegistry;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors({ origin: parseCorsOrigins(deps.config.CORS_ORIGIN) }));
  app.use(express.json({ limit: '45mb' }));

  // Public
  app.use(createHealthRouter(deps.pool));
  app.use('/api', createAuthRouter(deps));

  // Permissions are enforced per-route inside each router. Do not mount
  // requirePermission on `/api` here — it would gate every subsequent route.
  app.use('/api', createHostsRouter(deps));
  app.use('/api', createSettingsRouter(deps));
  app.use('/api', createInstallationsRouter(deps));
  app.use('/api', createServersRouter(deps));
  app.use('/api', createFilesRouter(deps));
  app.use('/api', createSchedulesRouter(deps));
  app.use('/api', createBackupsRouter(deps));
  app.use('/api', createModpacksRouter(deps));
  app.use('/api', createUsersRouter(deps));

  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      console.error(err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error',
      });
    },
  );

  return app;
}
