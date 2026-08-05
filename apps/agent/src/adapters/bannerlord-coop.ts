import type {
  AgentCommandRequest,
  AgentCommandResponse,
  ServerCreatePayload,
  ServerIdPayload,
  ServerPutConfigPayload,
} from '@bannerlord-panel/shared';
import type { DockerServerManager } from '../docker/server-manager.js';

interface ConfigLookupPayload extends ServerIdPayload {
  gamePort: number;
}

/**
 * First IGameServerAdapter implementation — Bannerlord Coop via Docker + Wine.
 */
export class BannerlordCoopAdapter {
  constructor(private readonly docker: DockerServerManager) {}

  async handle(request: AgentCommandRequest): Promise<AgentCommandResponse> {
    try {
      switch (request.action) {
        case 'server.create': {
          const payload = request.payload as ServerCreatePayload;
          const result = await this.docker.create(payload);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'server.start': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.start(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.stop': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.stop(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.restart': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.restart(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.kill': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.kill(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.delete': {
          const { serverId } = request.payload as ServerIdPayload;
          await this.docker.delete(serverId);
          return { requestId: request.requestId, ok: true };
        }
        case 'server.status': {
          const { serverId } = request.payload as ServerIdPayload;
          const result = await this.docker.status(serverId);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'server.getConfig': {
          const { serverId, gamePort } = request.payload as ConfigLookupPayload;
          const result = await this.docker.getConfig(serverId, gamePort);
          return { requestId: request.requestId, ok: true, result };
        }
        case 'server.putConfig': {
          const payload = request.payload as ServerPutConfigPayload & {
            gamePort: number;
          };
          const result = await this.docker.putConfig(
            payload,
            payload.gamePort,
          );
          return { requestId: request.requestId, ok: true, result };
        }
        default:
          return {
            requestId: request.requestId,
            ok: false,
            error: `Unsupported action: ${request.action}`,
          };
      }
    } catch (err) {
      return {
        requestId: request.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
