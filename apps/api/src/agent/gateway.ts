import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import {
  WsEvents,
  type AgentCommandAction,
  type AgentCommandRequest,
  type AgentCommandResponse,
  type AgentHeartbeatPayload,
  type ConsoleCommandPayload,
  type ConsoleLinePayload,
  type ConsoleSubscribePayload,
  type PlayerCountPayload,
  type PlayerLeftPayload,
  type PlayerRosterPayload,
} from '@bannerlord-panel/shared';
import { verifyAgentToken } from '../config.js';
import type { HostRegistry } from '../services/host-registry.js';

interface AgentSocketData {
  hostId: string;
}

const COMMAND_TIMEOUT_MS = 120_000;

/**
 * Authenticated Socket.IO namespace for Management Agents.
 */
export class AgentGateway {
  private readonly io: SocketServer;
  private readonly sockets = new Map<string, Socket>();
  private consoleHandler: ((payload: ConsoleLinePayload) => void) | null =
    null;
  private playerCountHandler: ((payload: PlayerCountPayload) => void) | null =
    null;
  private rosterHandler: ((payload: PlayerRosterPayload) => void) | null =
    null;
  private playerLeftHandler: ((payload: PlayerLeftPayload) => void) | null =
    null;

  constructor(
    httpServer: HttpServer,
    private readonly hosts: HostRegistry,
    corsOrigin: string,
  ) {
    this.io = new SocketServer(httpServer, {
      path: '/agent-socket',
      cors: { origin: corsOrigin },
    });

    this.io.of('/agent').use(async (socket, next) => {
      try {
        const token = String(socket.handshake.auth?.token ?? '');
        const hostId = String(socket.handshake.auth?.hostId ?? '');
        if (!token || !hostId) {
          next(new Error('Missing agent credentials'));
          return;
        }

        const tokenHash = await this.hosts.getHostTokenHash(hostId);
        if (!tokenHash || !verifyAgentToken(token, tokenHash)) {
          next(new Error('Invalid agent token'));
          return;
        }

        (socket.data as AgentSocketData).hostId = hostId;
        next();
      } catch (err) {
        next(err instanceof Error ? err : new Error('Auth failed'));
      }
    });

    this.io.of('/agent').on('connection', (socket) => {
      void this.onConnection(socket);
    });
  }

  onConsoleLine(handler: (payload: ConsoleLinePayload) => void): void {
    this.consoleHandler = handler;
  }

  onPlayerCount(handler: (payload: PlayerCountPayload) => void): void {
    this.playerCountHandler = handler;
  }

  onPlayerRoster(handler: (payload: PlayerRosterPayload) => void): void {
    this.rosterHandler = handler;
  }

  onPlayerLeft(handler: (payload: PlayerLeftPayload) => void): void {
    this.playerLeftHandler = handler;
  }

  getConnectedHostIds(): string[] {
    return [...this.sockets.keys()];
  }

  isHostConnected(hostId: string): boolean {
    return this.sockets.has(hostId);
  }

  emitToHost(hostId: string, event: string, payload: unknown): boolean {
    const socket = this.sockets.get(hostId);
    if (!socket) return false;
    socket.emit(event, payload);
    return true;
  }

  async subscribeConsole(
    hostId: string,
    serverId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.emitAck(hostId, WsEvents.AgentConsoleSubscribe, {
      serverId,
    } satisfies ConsoleSubscribePayload);
  }

  async unsubscribeConsole(
    hostId: string,
    serverId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.emitAck(hostId, WsEvents.AgentConsoleUnsubscribe, {
      serverId,
    } satisfies ConsoleSubscribePayload);
  }

  async injectConsole(
    hostId: string,
    serverId: string,
    command: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.emitAck(hostId, WsEvents.AgentConsoleInject, {
      serverId,
      command,
    } satisfies ConsoleCommandPayload);
  }

  async request(
    hostId: string,
    action: AgentCommandAction,
    payload: unknown,
  ): Promise<AgentCommandResponse> {
    const socket = this.sockets.get(hostId);
    if (!socket?.connected) {
      return {
        requestId: '',
        ok: false,
        error: `Agent for host ${hostId} is not connected`,
      };
    }

    const request: AgentCommandRequest = {
      requestId: randomUUID(),
      action,
      payload,
    };

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          requestId: request.requestId,
          ok: false,
          error: `Agent command timed out: ${action}`,
        });
      }, COMMAND_TIMEOUT_MS);

      socket.timeout(COMMAND_TIMEOUT_MS).emit(
        WsEvents.AgentCommand,
        request,
        (err: Error | null, response: AgentCommandResponse) => {
          clearTimeout(timer);
          if (err) {
            resolve({
              requestId: request.requestId,
              ok: false,
              error: err.message || `Agent command failed: ${action}`,
            });
            return;
          }
          resolve(
            response ?? {
              requestId: request.requestId,
              ok: false,
              error: 'Empty agent response',
            },
          );
        },
      );
    });
  }

  private emitAck(
    hostId: string,
    event: string,
    payload: unknown,
  ): Promise<{ ok: boolean; error?: string }> {
    const socket = this.sockets.get(hostId);
    if (!socket?.connected) {
      return Promise.resolve({
        ok: false,
        error: `Agent for host ${hostId} is not connected`,
      });
    }

    return new Promise((resolve) => {
      socket.timeout(30_000).emit(
        event,
        payload,
        (err: Error | null, response?: { ok: boolean; error?: string }) => {
          if (err) {
            resolve({ ok: false, error: err.message });
            return;
          }
          resolve(response ?? { ok: false, error: 'Empty agent response' });
        },
      );
    });
  }

  private async onConnection(socket: Socket): Promise<void> {
    const { hostId } = socket.data as AgentSocketData;
    const endpoint = String(socket.handshake.auth?.endpoint ?? '');

    const existing = this.sockets.get(hostId);
    if (existing && existing.id !== socket.id) {
      existing.disconnect(true);
    }
    this.sockets.set(hostId, socket);

    await this.hosts.markOnline(hostId, endpoint);
    console.log(`[agent-gateway] host ${hostId} connected`);

    socket.on(WsEvents.AgentHeartbeat, (payload: AgentHeartbeatPayload) => {
      void this.hosts.touchHeartbeat(payload.hostId || hostId);
    });

    socket.on(WsEvents.AgentConsole, (payload: ConsoleLinePayload) => {
      this.consoleHandler?.(payload);
    });

    socket.on(WsEvents.AgentPlayerCount, (payload: PlayerCountPayload) => {
      this.playerCountHandler?.(payload);
    });

    socket.on(WsEvents.AgentPlayerRoster, (payload: PlayerRosterPayload) => {
      this.rosterHandler?.(payload);
    });

    socket.on(WsEvents.AgentPlayerLeft, (payload: PlayerLeftPayload) => {
      this.playerLeftHandler?.(payload);
    });

    socket.on(WsEvents.AgentServerState, (payload: unknown) => {
      console.log('[agent-gateway] server state', payload);
    });

    socket.on('disconnect', (reason) => {
      if (this.sockets.get(hostId)?.id === socket.id) {
        this.sockets.delete(hostId);
        void this.hosts.markOffline(hostId);
      }
      console.log(`[agent-gateway] host ${hostId} disconnected: ${reason}`);
    });
  }
}
