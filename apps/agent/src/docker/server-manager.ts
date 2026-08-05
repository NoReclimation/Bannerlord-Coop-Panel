import type Dockerode from 'dockerode';
import {
  COOP_CONTAINER_LISTEN,
  type ServerConfigBundle,
  type ServerCreatePayload,
  type ServerCreateResult,
  type ServerPutConfigPayload,
} from '@bannerlord-panel/shared';
import type { AgentConfig } from '../config.js';
import { containerNameFor } from './client.js';
import {
  ensureServerFilesystem,
  readServerConfig,
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

export class DockerServerManager {
  constructor(
    private readonly docker: Dockerode,
    private readonly config: AgentConfig,
  ) {}

  async create(payload: ServerCreatePayload): Promise<ServerCreateResult> {
    const { root, wineDir } = await ensureServerFilesystem(
      this.config,
      payload,
    );
    const name = containerNameFor(payload.serverId);

    try {
      const existing = this.docker.getContainer(name);
      await existing.remove({ force: true });
    } catch {
      // not found
    }

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
          `${payload.installationPath}:/opt/bannerlord`,
          `${root}:/srv/instance`,
          `${wineDir}:/wineprefix`,
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
    if (this.needsRecreate(info, resolved)) {
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
    if (this.needsRecreate(info, resolved)) {
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

  private needsRecreate(
    info: Dockerode.ContainerInspectInfo,
    ports?: { gamePort: number; enginePort: number },
  ): boolean {
    if (installationBindIsReadOnly(info)) return true;
    if (!ports) return false;
    return portPublishNeedsHeal(info, ports.gamePort, ports.enginePort);
  }

  /**
   * Heal RO install mounts and/or wrong port publish (pre-NAT containers that
   * mapped hostPort→hostPort while Coop still listens on 4200/7210).
   */
  private async recreateHealthy(
    serverId: string,
    info: Dockerode.ContainerInspectInfo,
    ports: { gamePort: number; enginePort: number },
  ): Promise<void> {
    const name = containerNameFor(serverId);
    const binds = (info.HostConfig.Binds ?? []).map((bind) =>
      bind.includes(':/opt/bannerlord:ro')
        ? bind.replace(':/opt/bannerlord:ro', ':/opt/bannerlord')
        : bind,
    );

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
    await container.start();
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
