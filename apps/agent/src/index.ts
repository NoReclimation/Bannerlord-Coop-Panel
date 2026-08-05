import { createServer } from 'node:http';
import { loadAgentConfig } from './config.js';
import { createDockerClient } from './docker/client.js';
import { DockerServerManager } from './docker/server-manager.js';
import { ConsoleStreamer } from './docker/console-streamer.js';
import { ServerFileManager } from './fs/server-file-manager.js';
import { BackupManager } from './fs/backup-manager.js';
import { InstallationManager } from './fs/installation-manager.js';
import { AgentCommandRouter } from './adapters/command-router.js';
import { ApiConnection } from './api-connection.js';
import { createAgentApp } from './app.js';

async function main(): Promise<void> {
  const config = loadAgentConfig();
  const docker = createDockerClient(config);
  const manager = new DockerServerManager(docker, config);
  const files = new ServerFileManager(config);
  const backups = new BackupManager(config);
  const installations = new InstallationManager(config);

  await installations.ensureDirs();

  const connectionRef: { current: ApiConnection | null } = { current: null };
  const consoleStreamer = new ConsoleStreamer(
    docker,
    (line) => {
      connectionRef.current?.emitConsoleLine(line);
    },
    (players) => {
      connectionRef.current?.emitPlayerCount(players);
    },
    (roster) => {
      connectionRef.current?.emitPlayerRoster(roster);
    },
    (left) => {
      connectionRef.current?.emitPlayerLeft(left);
    },
  );
  const router = new AgentCommandRouter(
    manager,
    files,
    backups,
    installations,
    consoleStreamer,
  );

  const connection = new ApiConnection(config, router, consoleStreamer);
  connectionRef.current = connection;

  const app = createAgentApp(config, connection);
  const httpServer = createServer(app);

  connection.connect();

  httpServer.listen(config.AGENT_PORT, config.AGENT_HOST, () => {
    console.log(
      `[agent] health on http://${config.AGENT_HOST}:${config.AGENT_PORT}/health`,
    );
    console.log(
      `[agent] host ${config.AGENT_NAME} (${config.HOST_ID}) dataRoot=${config.AGENT_DATA_ROOT}`,
    );
    console.log(`[agent] runtime image=${config.RUNTIME_IMAGE}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[agent] shutting down (${signal})`);
    connection.disconnect();
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[agent] fatal', err);
  process.exit(1);
});
