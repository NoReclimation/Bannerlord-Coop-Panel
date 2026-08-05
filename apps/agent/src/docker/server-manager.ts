import type Dockerode from 'dockerode';
import type {
  ServerConfigBundle,
  ServerCreatePayload,
  ServerCreateResult,
  ServerPutConfigPayload,
} from '@bannerlord-panel/shared';
import type { AgentConfig } from '../config.js';
import { containerNameFor } from './client.js';
import {
  ensureServerFilesystem,
  readServerConfig,
  writeServerConfig,
} from './filesystem.js';

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
        Binds: [
          `${payload.installationPath}:/opt/bannerlord:ro`,
          `${root}:/srv/instance`,
          `${wineDir}:/wineprefix`,
        ],
        PortBindings: {
          [`${payload.gamePort}/udp`]: [
            { HostPort: String(payload.gamePort) },
          ],
          [`${payload.enginePort}/udp`]: [
            { HostPort: String(payload.enginePort) },
          ],
        },
        RestartPolicy: { Name: 'unless-stopped' },
      },
      ExposedPorts: {
        [`${payload.gamePort}/udp`]: {},
        [`${payload.enginePort}/udp`]: {},
      },
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

  async start(serverId: string): Promise<void> {
    const container = await this.getByServerId(serverId);
    const info = await container.inspect();
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

  async restart(serverId: string): Promise<void> {
    const container = await this.getByServerId(serverId);
    await container.restart({ t: 30 });
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
