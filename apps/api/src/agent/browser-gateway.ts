import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import {
  hasPermission,
  WsEvents,
  type ConsoleCommandPayload,
  type ConsoleLinePayload,
  type ConsoleStatusPayload,
  type ConsoleSubscribePayload,
  type RestartCountdownPayload,
} from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import { verifyAccessToken } from '../auth/tokens.js';
import type { UserRegistry } from '../services/user-registry.js';
import type { ServerRegistry } from '../services/server-registry.js';
import type { AgentGateway } from './gateway.js';

interface ClientSocketData {
  userId: string;
  role: string;
  subscriptions: Set<string>;
}

/**
 * Browser Socket.IO gateway for realtime console (and future metrics).
 */
export class BrowserGateway {
  private readonly io: SocketServer;
  /** serverId → number of browser sockets subscribed */
  private readonly roomCounts = new Map<string, number>();

  constructor(
    httpServer: HttpServer,
    private readonly config: ApiConfig,
    private readonly users: UserRegistry,
    private readonly servers: ServerRegistry,
    private readonly agents: AgentGateway,
    corsOrigin: string,
  ) {
    this.io = new SocketServer(httpServer, {
      path: '/client-socket',
      cors: { origin: corsOrigin },
    });

    this.agents.onConsoleLine((payload) => this.fanoutConsole(payload));

    this.io.of('/client').use(async (socket, next) => {
      try {
        const token = String(socket.handshake.auth?.token ?? '');
        if (!token) {
          next(new Error('Missing access token'));
          return;
        }
        const payload = verifyAccessToken(this.config, token);
        const user = await this.users.get(payload.sub);
        if (!user || user.disabled) {
          next(new Error('Invalid user'));
          return;
        }
        if (!hasPermission(user.role, 'console:read')) {
          next(new Error('Forbidden'));
          return;
        }
        (socket.data as ClientSocketData).userId = user.id;
        (socket.data as ClientSocketData).role = user.role;
        (socket.data as ClientSocketData).subscriptions = new Set();
        next();
      } catch (err) {
        next(err instanceof Error ? err : new Error('Auth failed'));
      }
    });

    this.io.of('/client').on('connection', (socket) => {
      this.onConnection(socket);
    });
  }

  private onConnection(socket: Socket): void {
    const data = socket.data as ClientSocketData;
    console.log(`[client-gateway] user ${data.userId} connected`);

    socket.on(
      WsEvents.ConsoleSubscribe,
      async (payload: ConsoleSubscribePayload) => {
        await this.handleSubscribe(socket, payload.serverId);
      },
    );

    socket.on(
      WsEvents.ConsoleUnsubscribe,
      async (payload: ConsoleSubscribePayload) => {
        await this.handleUnsubscribe(socket, payload.serverId);
      },
    );

    socket.on(
      WsEvents.ConsoleCommand,
      async (payload: ConsoleCommandPayload) => {
        await this.handleCommand(socket, payload);
      },
    );

    socket.on('disconnect', () => {
      const subs = [...(socket.data as ClientSocketData).subscriptions];
      for (const serverId of subs) {
        void this.handleUnsubscribe(socket, serverId);
      }
    });
  }

  private fanoutConsole(payload: ConsoleLinePayload): void {
    this.io
      .of('/client')
      .to(`server:${payload.serverId}`)
      .emit(WsEvents.ConsoleLine, payload);
  }

  /** Used by scheduler / internal services to echo into live consoles. */
  emitConsoleLine(payload: ConsoleLinePayload): void {
    this.fanoutConsole(payload);
  }

  emitRestartCountdown(payload: RestartCountdownPayload): void {
    this.io
      .of('/client')
      .to(`server:${payload.serverId}`)
      .emit(WsEvents.RestartCountdown, payload);
  }

  private emitStatus(socket: Socket, status: ConsoleStatusPayload): void {
    socket.emit(WsEvents.ConsoleStatus, status);
  }

  private async handleSubscribe(
    socket: Socket,
    serverId: string,
  ): Promise<void> {
    const server = await this.servers.get(serverId);
    if (!server) {
      this.emitStatus(socket, {
        serverId,
        subscribed: false,
        streaming: false,
        message: 'Server not found',
      });
      return;
    }

    const room = `server:${serverId}`;
    const data = socket.data as ClientSocketData;
    if (!data.subscriptions.has(serverId)) {
      await socket.join(room);
      data.subscriptions.add(serverId);
      const count = (this.roomCounts.get(serverId) ?? 0) + 1;
      this.roomCounts.set(serverId, count);

      if (count === 1) {
        const result = await this.agents.subscribeConsole(
          server.hostId,
          serverId,
        );
        if (!result.ok) {
          this.emitStatus(socket, {
            serverId,
            subscribed: true,
            streaming: false,
            message: result.error ?? 'Agent subscribe failed',
          });
          return;
        }
      }
    }

    this.emitStatus(socket, {
      serverId,
      subscribed: true,
      streaming: true,
      message: 'Live console connected',
    });
  }

  private async handleUnsubscribe(
    socket: Socket,
    serverId: string,
  ): Promise<void> {
    const room = `server:${serverId}`;
    const data = socket.data as ClientSocketData;
    if (!data.subscriptions.has(serverId)) return;

    await socket.leave(room);
    data.subscriptions.delete(serverId);
    const count = Math.max(0, (this.roomCounts.get(serverId) ?? 1) - 1);
    if (count === 0) {
      this.roomCounts.delete(serverId);
      const server = await this.servers.get(serverId);
      if (server) {
        await this.agents.unsubscribeConsole(server.hostId, serverId);
      }
    } else {
      this.roomCounts.set(serverId, count);
    }
  }

  private async handleCommand(
    socket: Socket,
    payload: ConsoleCommandPayload,
  ): Promise<void> {
    const data = socket.data as ClientSocketData;
    const user = await this.users.get(data.userId);
    if (!user || !hasPermission(user.role, 'console:write')) {
      this.emitStatus(socket, {
        serverId: payload.serverId,
        subscribed: true,
        streaming: true,
        message: 'Forbidden: cannot send console commands',
      });
      return;
    }

    const command = payload.command.trim();
    if (!command) return;

    const server = await this.servers.get(payload.serverId);
    if (!server) return;

    // Echo the command into the room so operators see what was sent
    this.fanoutConsole({
      serverId: payload.serverId,
      line: `> ${command}`,
      stream: 'stdout',
      at: new Date().toISOString(),
    });

    const result = await this.agents.injectConsole(
      server.hostId,
      payload.serverId,
      command,
    );
    if (!result.ok) {
      this.fanoutConsole({
        serverId: payload.serverId,
        line: `[panel] inject failed: ${result.error ?? 'unknown'}`,
        stream: 'stderr',
        at: new Date().toISOString(),
      });
    }
  }
}
