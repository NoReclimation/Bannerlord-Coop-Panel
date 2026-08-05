import Dockerode from 'dockerode';
import type { AgentConfig } from '../config.js';

export function createDockerClient(config: AgentConfig): Dockerode {
  return new Dockerode({ socketPath: config.DOCKER_SOCKET });
}

export function containerNameFor(serverId: string): string {
  const short = serverId.replace(/-/g, '').slice(0, 12);
  return `blc-${short}`;
}
