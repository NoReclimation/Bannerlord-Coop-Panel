import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import {
  hasPermission,
  WsEvents,
  type ConsoleCommandPayload,
  type ConsoleLinePayload,
  type ConsoleStatusPayload,
  type ConsoleSubscribePayload,
  type PlayerCountPayload,
  type RestartCountdownPayload,
  type SavePlayerIdentity,
} from '@bannerlord-panel/shared';
import type { ApiConfig } from '../config.js';
import { verifyAccessToken } from '../auth/tokens.js';
import type { UserRegistry } from '../services/user-registry.js';
import type { ServerRegistry } from '../services/server-registry.js';
import type { UserServerRegistry } from '../services/user-server-registry.js';
import type { AgentGateway } from './gateway.js';
import type { PlayerCountStore } from '../services/player-count-store.js';
import type { PlaytimeRegistry } from '../services/playtime-registry.js';
import { userCanAccessServer } from '../auth/server-access.js';

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
    private readonly userServers: UserServerRegistry,
    private readonly agents: AgentGateway,
    private readonly playerCounts: PlayerCountStore,
    private readonly playtime: PlaytimeRegistry,
    corsOrigin: string,
  ) {
    this.io = new SocketServer(httpServer, {
      path: '/client-socket',
      cors: { origin: corsOrigin },
    });

    this.agents.onConsoleLine((payload) => this.fanoutConsole(payload));
    this.agents.onPlayerCount((payload) => this.handlePlayerCount(payload));
    this.agents.onPlayerLeft((payload) => {
      void this.playtime.applyLeave(payload).then(() => {
        this.io
          .of('/client')
          .to(`server:${payload.serverId}`)
          .emit(WsEvents.PlayerLeft, payload);
      });
    });
    this.agents.onPlayerParty((payload) => {
      void this.refreshSavePlayers(payload.serverId).then(() =>
        this.playtime.applyParty(payload),
      );
    });
    this.agents.onPlayerRoster((payload) => {
      void this.refreshSavePlayers(payload.serverId);
      void this.playtime.applyRoster(payload).then(() => {
        this.io
          .of('/client')
          .to(`server:${payload.serverId}`)
          .emit(WsEvents.PlayerJoined, payload);
        this.io.of('/client').to('servers').emit(WsEvents.PlayerCount, {
          serverId: payload.serverId,
          playerCount: payload.players.length,
          at: payload.at,
        });
        this.playerCounts.set({
          serverId: payload.serverId,
          playerCount: payload.players.length,
          at: payload.at,
        });
      });
    });

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

    void socket.join('servers');

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

  private handlePlayerCount(payload: PlayerCountPayload): void {
    this.playerCounts.set(payload);
    this.io.of('/client').to(`server:${payload.serverId}`).emit(
      WsEvents.PlayerCount,
      payload,
    );
    this.io.of('/client').to('servers').emit(WsEvents.PlayerCount, payload);
  }

  private async refreshSavePlayers(serverId: string): Promise<void> {
    try {
      const server = await this.servers.get(serverId);
      if (!server || !this.agents.isHostConnected(server.hostId)) return;
      const res = await this.agents.request(
        server.hostId,
        'server.readSavePlayers',
        { serverId: server.id, saveName: server.saveName },
      );
      if (!res.ok || !res.result) return;
      const result = res.result as { players?: SavePlayerIdentity[] };
      this.playtime.setSavePlayers(serverId, result.players ?? []);
    } catch {
      // save.json may be missing while the campaign starts
    }
  }

  clearPlayerCount(serverId: string): void {
    this.playerCounts.clear(serverId);
    void this.playtime.closeAllForServer(serverId);
    const payload: PlayerCountPayload = {
      serverId,
      playerCount: 0,
      at: new Date().toISOString(),
    };
    this.io.of('/client').to(`server:${serverId}`).emit(
      WsEvents.PlayerCount,
      payload,
    );
    this.io.of('/client').to('servers').emit(WsEvents.PlayerCount, payload);
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
    const data = socket.data as ClientSocketData;
    const user = await this.users.get(data.userId);
    if (
      !user ||
      !(await userCanAccessServer(user, serverId, this.userServers))
    ) {
      this.emitStatus(socket, {
        serverId,
        subscribed: false,
        streaming: false,
        message: 'Server not found',
      });
      return;
    }

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

    const known = this.playerCounts.get(serverId);
    if (known !== null) {
      socket.emit(WsEvents.PlayerCount, {
        serverId,
        playerCount: known,
        at: new Date().toISOString(),
      } satisfies PlayerCountPayload);
    }
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
    if (!(await userCanAccessServer(user, payload.serverId, this.userServers))) {
      this.emitStatus(socket, {
        serverId: payload.serverId,
        subscribed: false,
        streaming: false,
        message: 'Server not found',
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
