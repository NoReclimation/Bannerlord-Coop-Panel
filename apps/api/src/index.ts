import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiConfig, parseCorsOrigins } from './config.js';
import { createPool } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { HostRegistry } from './services/host-registry.js';
import { InstallationRegistry } from './services/installation-registry.js';
import { ServerRegistry } from './services/server-registry.js';
import { PortAllocator } from './services/port-allocator.js';
import { UserRegistry } from './services/user-registry.js';
import { RefreshTokenStore } from './services/refresh-token-store.js';
import { AgentGateway } from './agent/gateway.js';
import { BrowserGateway } from './agent/browser-gateway.js';
import { createApp } from './app.js';
import { ScheduleRegistry } from './services/schedule-registry.js';
import { ScheduleRunner } from './services/schedule-runner.js';
import { BackupRegistry } from './services/backup-registry.js';
import { PlayerCountStore } from './services/player-count-store.js';
import { PlaytimeRegistry } from './services/playtime-registry.js';
import { DeleteRequestRegistry } from './services/delete-request-registry.js';
import { UserServerRegistry } from './services/user-server-registry.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function main(): Promise<void> {
  const config = loadApiConfig();
  const pool = createPool(config.DATABASE_URL);

  const migrationsDir = resolve(__dirname, '../../../database/migrations');
  const applied = await runMigrations(pool, migrationsDir);
  if (applied.length > 0) {
    console.log(`[api] migrations applied: ${applied.join(', ')}`);
  }

  const hosts = new HostRegistry(pool);
  const installations = new InstallationRegistry(pool);
  const servers = new ServerRegistry(pool);
  const ports = new PortAllocator(pool);
  const users = new UserRegistry(pool);
  const refreshTokens = new RefreshTokenStore(pool);
  const playerCounts = new PlayerCountStore();
  const playtime = new PlaytimeRegistry(pool);
  const deleteRequests = new DeleteRequestRegistry(pool);
  const userServers = new UserServerRegistry(pool);

  const defaultHost = await hosts.seedDefaultHost(config);
  console.log(
    `[api] default host ready: ${defaultHost.name} (${defaultHost.id})`,
  );

  const admin = await users.seedAdmin({
    username: config.ADMIN_USERNAME,
    password: config.ADMIN_PASSWORD,
  });
  console.log(`[api] admin user ready: ${admin.username} (${admin.role})`);

  const httpServer = createServer();
  const corsOrigin = parseCorsOrigins(config.CORS_ORIGIN);
  const gateway = new AgentGateway(httpServer, hosts, corsOrigin);
  const browserGateway = new BrowserGateway(
    httpServer,
    config,
    users,
    servers,
    userServers,
    gateway,
    playerCounts,
    playtime,
    corsOrigin,
  );

  const schedules = new ScheduleRegistry(pool);
  const backups = new BackupRegistry(pool);
  const scheduleRunner = new ScheduleRunner(
    schedules,
    servers,
    gateway,
    browserGateway,
    backups,
  );

  const app = createApp({
    config,
    pool,
    hosts,
    installations,
    servers,
    ports,
    users,
    refreshTokens,
    gateway,
    schedules,
    scheduleRunner,
    backups,
    playerCounts,
    browserGateway,
    playtime,
    deleteRequests,
    userServers,
  });
  // Socket.IO attaches its own `request` listeners on the same server.
  // Do not let Express touch those paths — dual writers cause 500s on
  // Engine.IO polling (and can destabilize the process).
  httpServer.on('request', (req, res) => {
    const url = req.url ?? '';
    if (url.startsWith('/client-socket') || url.startsWith('/agent-socket')) {
      return;
    }
    app(req, res);
  });

  httpServer.listen(config.API_PORT, config.API_HOST, () => {
    console.log(
      `[api] listening on http://${config.API_HOST}:${config.API_PORT}`,
    );
    scheduleRunner.start();
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] shutting down (${signal})`);
    scheduleRunner.stop();
    httpServer.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] fatal', err);
  process.exit(1);
});
