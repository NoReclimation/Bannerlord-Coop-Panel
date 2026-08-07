import type Dockerode from 'dockerode';
import {
  COOP_CONTAINER_LISTEN,
  type ServerConfigBundle,
  type ServerCreatePayload,
  type ServerCreateResult,
  type ServerPutConfigPayload,
} from '@bannerlord-panel/shared';
import type { AgentConfig } from '../config.js';
import type { ModulesManager } from '../fs/modules-manager.js';
import { containerNameFor } from './client.js';
import {
  ensureServerFilesystem,
  readServerConfig,
  serverRoot,
  writeServerConfig,
} from './filesystem.js';

function installationBindIsReadOnly(
  info: Dockerode.ContainerInspectInfo,
): boolean {
  return (info.HostConfig.Binds ?? []).some((bind) =>
    bind.includes(':/opt/bannerlord:ro'),
  );
}

function hostPortForBinding(
  bindings: Dockerode.ContainerInspectInfo['HostConfig']['PortBindings'],
  containerPort: string,
): string | undefined {
  const entries = bindings?.[containerPort];
  return entries?.[0]?.HostPort;
}

/**
 * Coop listens on fixed ports inside the container; Docker must publish
 * host gamePort → 4200/udp and host enginePort → 7210/udp.
 */
function portPublishNeedsHeal(
  info: Dockerode.ContainerInspectInfo,
  gamePort: number,
  enginePort: number,
): boolean {
  const bindings = info.HostConfig.PortBindings ?? {};
  const gameKey = `${COOP_CONTAINER_LISTEN.gamePort}/udp`;
  const engineKey = `${COOP_CONTAINER_LISTEN.enginePort}/udp`;
  return (
    hostPortForBinding(bindings, gameKey) !== String(gamePort) ||
    hostPortForBinding(bindings, engineKey) !== String(enginePort)
  );
}

function coopPortBindings(
  gamePort: number,
  enginePort: number,
): NonNullable<Dockerode.ContainerCreateOptions['HostConfig']>['PortBindings'] {
  return {
    [`${COOP_CONTAINER_LISTEN.gamePort}/udp`]: [
      { HostPort: String(gamePort) },
    ],
    [`${COOP_CONTAINER_LISTEN.enginePort}/udp`]: [
      { HostPort: String(enginePort) },
    ],
  };
}

function coopExposedPorts(): Record<string, object> {
  return {
    [`${COOP_CONTAINER_LISTEN.gamePort}/udp`]: {},
    [`${COOP_CONTAINER_LISTEN.enginePort}/udp`]: {},
  };
}

function portsFromContainer(
  info: Dockerode.ContainerInspectInfo,
): { gamePort: number; enginePort: number } | undefined {
  const labels = info.Config.Labels ?? {};
  const fromLabelsGame = Number(labels['bannerlord.game_port']);
  const fromLabelsEngine = Number(labels['bannerlord.engine_port']);
  if (
    Number.isFinite(fromLabelsGame) &&
    fromLabelsGame > 0 &&
    Number.isFinite(fromLabelsEngine) &&
    fromLabelsEngine > 0
  ) {
    return { gamePort: fromLabelsGame, enginePort: fromLabelsEngine };
  }

  // Legacy: PortBindings used `${hostPort}/udp` → HostPort hostPort.
  const bindings = info.HostConfig.PortBindings ?? {};
  let gamePort: number | undefined;
  let enginePort: number | undefined;
  for (const [key, val] of Object.entries(bindings)) {
    if (!key.endsWith('/udp')) continue;
    const containerPort = Number(key.split('/')[0]);
    const mapped = Array.isArray(val) ? val[0] : undefined;
    const hostPort = Number(mapped?.HostPort);
    if (!Number.isFinite(containerPort) || !Number.isFinite(hostPort)) continue;
    if (containerPort === COOP_CONTAINER_LISTEN.gamePort || containerPort === hostPort) {
      if (
        containerPort < COOP_CONTAINER_LISTEN.enginePort &&
        hostPort < COOP_CONTAINER_LISTEN.enginePort
      ) {
        gamePort = hostPort;
      }
    }
    if (
      containerPort === COOP_CONTAINER_LISTEN.enginePort ||
      containerPort >= COOP_CONTAINER_LISTEN.enginePort
    ) {
      enginePort = hostPort;
    }
  }
  if (gamePort && enginePort) return { gamePort, enginePort };
  return undefined;
}

function installationPathFromBinds(binds: string[]): string | undefined {
  for (const bind of binds) {
    const idx = bind.indexOf(':/opt/bannerlord');
    if (idx > 0) return bind.slice(0, idx);
  }
  return undefined;
}

function coreBinds(
  installationPath: string,
  root: string,
  wineDir: string,
): string[] {
  return [
    `${installationPath}:/opt/bannerlord`,
    `${root}:/srv/instance`,
    `${wineDir}:/wineprefix`,
  ];
}

function modBindsEqual(current: string[], desired: string[]): boolean {
  const a = [...current].filter((b) => b.includes('/engine/Modules/')).sort();
  const b = [...desired].sort();
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export class DockerServerManager {
  constructor(
    private readonly docker: Dockerode,
    private readonly config: AgentConfig,
    private readonly modules: ModulesManager,
  ) {}

  async create(payload: ServerCreatePayload): Promise<ServerCreateResult> {
    const { root, wineDir } = await ensureServerFilesystem(
      this.config,
      payload,
    );

    // Seed default module load order from the installation scan.
    try {
      await this.modules.getConfig(payload.serverId, payload.installationPath);
    } catch {
      // Install may lack Modules yet; entrypoint falls back safely.
    }

    const name = containerNameFor(payload.serverId);

    try {
      const existing = this.docker.getContainer(name);
      await existing.remove({ force: true });
    } catch {
      // not found
    }

    const modBinds = await this.modules.globalBindsFor(
      payload.serverId,
      payload.installationPath,
    );

    const container = await this.docker.createContainer({
      name,
      Image: this.config.RUNTIME_IMAGE,
      Labels: {
        'bannerlord.panel': '1',
        'bannerlord.server_id': payload.serverId,
        'bannerlord.name': payload.name,
        'bannerlord.game_port': String(payload.gamePort),
        'bannerlord.engine_port': String(payload.enginePort),
      },
      Env: [
        'WINEPREFIX=/wineprefix',
        'WINEARCH=win64',
        'WINEDEBUG=-all',
        'BANNERLORD_INSTALL=/opt/bannerlord',
        'BANNERLORD_INSTANCE=/srv/instance',
      ],
      Tty: false,
      OpenStdin: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        // Coop AutoSync writes AssemblyInfo.cs under
        // engine/Modules/Coop/.../AutoSyncExport — install cannot be :ro.
        Binds: [
          ...coreBinds(payload.installationPath, root, wineDir),
          ...modBinds,
        ],
        PortBindings: coopPortBindings(payload.gamePort, payload.enginePort),
        RestartPolicy: { Name: 'unless-stopped' },
      },
      ExposedPorts: coopExposedPorts(),
    });

    const info = await container.inspect();
    return {
      containerId: info.Id,
      containerName: name,
      dataPath: root,
    };
  }

  async getConfig(
    serverId: string,
    gamePort: number,
  ): Promise<ServerConfigBundle> {
    return readServerConfig(this.config, serverId, gamePort);
  }

  async putConfig(
    payload: ServerPutConfigPayload,
    gamePort: number,
  ): Promise<ServerConfigBundle> {
    return writeServerConfig(this.config, payload, gamePort);
  }

  async start(
    serverId: string,
    ports?: { gamePort: number; enginePort: number },
  ): Promise<void> {
    const container = await this.getByServerId(serverId);
    const info = await container.inspect();
    const resolved = ports ?? portsFromContainer(info);
    if (await this.needsRecreate(info, resolved, serverId)) {
      if (!resolved) {
        throw new Error(
          'Cannot heal container publish mappings: missing game/engine ports',
        );
      }
      await this.recreateHealthy(serverId, info, resolved);
      return;
    }
    if (!info.State.Running) {
      await container.start();
    }
  }

  async stop(serverId: string): Promise<void> {
    const container = await this.getByServerId(serverId);
    const info = await container.inspect();
    if (info.State.Running) {
      await container.stop({ t: 30 });
    }
  }

  async restart(
    serverId: string,
    ports?: { gamePort: number; enginePort: number },
  ): Promise<void> {
    const container = await this.getByServerId(serverId);
    const info = await container.inspect();
    const resolved = ports ?? portsFromContainer(info);
    if (await this.needsRecreate(info, resolved, serverId)) {
      if (!resolved) {
        throw new Error(
          'Cannot heal container publish mappings: missing game/engine ports',
        );
      }
      await this.recreateHealthy(serverId, info, resolved);
      return;
    }
    await container.restart({ t: 30 });
  }

  /**
   * Recreate container binds after modules.json changes (keeps running state).
   */
  async recreateForModules(serverId: string): Promise<void> {
    try {
      const container = await this.getByServerId(serverId);
      const info = await container.inspect();
      const ports = portsFromContainer(info);
      if (!ports) {
        // Container exists but ports unknown — skip until next start/restart.
        return;
      }
      const wasRunning = Boolean(info.State.Running);
      await this.recreateHealthy(serverId, info, ports, wasRunning);
    } catch {
      // No container yet — binds will apply on create/start.
    }
  }

  private async needsRecreate(
    info: Dockerode.ContainerInspectInfo,
    ports?: { gamePort: number; enginePort: number },
    serverId?: string,
  ): Promise<boolean> {
    if (installationBindIsReadOnly(info)) return true;
    if (ports && portPublishNeedsHeal(info, ports.gamePort, ports.enginePort)) {
      return true;
    }
    if (serverId) {
      const binds = info.HostConfig.Binds ?? [];
      const installationPath = installationPathFromBinds(binds);
      const desired = await this.modules.globalBindsFor(
        serverId,
        installationPath,
      );
      if (!modBindsEqual(binds, desired)) return true;
    }
    return false;
  }

  /**
   * Heal RO install mounts, wrong port publish, and/or module bind drift.
   */
  private async recreateHealthy(
    serverId: string,
    info: Dockerode.ContainerInspectInfo,
    ports: { gamePort: number; enginePort: number },
    startAfter = true,
  ): Promise<void> {
    const name = containerNameFor(serverId);
    const root = serverRoot(this.config, serverId);
    const wineDir = `${root}/wineprefix`;
    const existingBinds = (info.HostConfig.Binds ?? []).map((bind) =>
      bind.includes(':/opt/bannerlord:ro')
        ? bind.replace(':/opt/bannerlord:ro', ':/opt/bannerlord')
        : bind,
    );
    const installationPath =
      installationPathFromBinds(existingBinds) ??
      existingBinds
        .find((b) => b.includes(':/opt/bannerlord'))
        ?.split(':/opt/bannerlord')[0];
    if (!installationPath) {
      throw new Error('Cannot recreate container: missing installation bind');
    }

    const modBinds = await this.modules.globalBindsFor(
      serverId,
      installationPath,
    );
    const binds = [...coreBinds(installationPath, root, wineDir), ...modBinds];

    const labels = {
      ...(info.Config.Labels ?? {}),
      'bannerlord.game_port': String(ports.gamePort),
      'bannerlord.engine_port': String(ports.enginePort),
    };

    try {
      await this.docker.getContainer(name).remove({ force: true });
    } catch {
      // already gone
    }

    const container = await this.docker.createContainer({
      name,
      Image: info.Config.Image,
      Labels: labels,
      Env: info.Config.Env ?? undefined,
      Tty: false,
      OpenStdin: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        Binds: binds,
        PortBindings: coopPortBindings(ports.gamePort, ports.enginePort),
        RestartPolicy: info.HostConfig.RestartPolicy ?? {
          Name: 'unless-stopped',
        },
      },
      ExposedPorts: coopExposedPorts(),
    });
    if (startAfter) {
      await container.start();
    }
  }

  async kill(serverId: string): Promise<void> {
    const container = await this.getByServerId(serverId);
    await container.kill();
  }

  /**
   * Remove container. Does not delete host data or backups.
   */
  async delete(serverId: string): Promise<void> {
    try {
      const container = await this.getByServerId(serverId);
      await container.remove({ force: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/no such container|404/i.test(message)) {
        throw err;
      }
    }
  }

  async status(serverId: string): Promise<{
    serverId: string;
    containerId?: string;
    dockerState?: string;
    running: boolean;
  }> {
    try {
      const container = await this.getByServerId(serverId);
      const info = await container.inspect();
      return {
        serverId,
        containerId: info.Id,
        dockerState: info.State.Status,
        running: Boolean(info.State.Running),
      };
    } catch {
      return { serverId, running: false };
    }
  }

  private async getByServerId(serverId: string): Promise<Dockerode.Container> {
    const name = containerNameFor(serverId);
    const container = this.docker.getContainer(name);
    await container.inspect();
    return container;
  }
}
