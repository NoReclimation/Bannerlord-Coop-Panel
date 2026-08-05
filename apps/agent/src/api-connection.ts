import { io, type Socket } from 'socket.io-client';
import {
  WsEvents,
  type AgentCommandRequest,
  type AgentCommandResponse,
  type ConsoleCommandPayload,
  type ConsoleLinePayload,
  type ConsoleSubscribePayload,
} from '@bannerlord-panel/shared';
import type { AgentConfig } from './config.js';
import type { AgentCommandRouter } from './adapters/command-router.js';
import type { ConsoleStreamer } from './docker/console-streamer.js';

/**
 * Persistent Socket.IO connection from this host agent to the API.
 */
export class ApiConnection {
  private socket: Socket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: AgentConfig,
    private readonly router: AgentCommandRouter,
    private readonly consoleStreamer: ConsoleStreamer,
  ) {}

  isConnected(): boolean {
    return this.socket?.connected === true;
  }

  emitConsoleLine(payload: ConsoleLinePayload): void {
    this.socket?.emit(WsEvents.AgentConsole, payload);
  }

  connect(): void {
    if (this.socket) return;

    const url = this.config.API_URL.replace(/\/$/, '');
    this.socket = io(`${url}/agent`, {
      path: '/agent-socket',
      transports: ['websocket', 'polling'],
      auth: {
        token: this.config.AGENT_TOKEN,
        hostId: this.config.HOST_ID,
        endpoint: `http://127.0.0.1:${this.config.AGENT_PORT}`,
      },
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
    });

    this.socket.on('connect', () => {
      console.log(`[agent] connected to API at ${url}`);
      this.startHeartbeat();
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`[agent] disconnected from API: ${reason}`);
      this.stopHeartbeat();
    });

    this.socket.on('connect_error', (err) => {
      console.error(`[agent] connect error: ${err.message}`);
    });

    this.socket.on(
      WsEvents.AgentCommand,
      (
        request: AgentCommandRequest,
        ack?: (response: AgentCommandResponse) => void,
      ) => {
        void this.router.handle(request).then((response) => {
          console.log(
            `[agent] ${request.action} → ${response.ok ? 'ok' : response.error}`,
          );
          ack?.(response);
        });
      },
    );

    this.socket.on(
      WsEvents.AgentConsoleSubscribe,
      async (
        payload: ConsoleSubscribePayload,
        ack?: (result: { ok: boolean; error?: string }) => void,
      ) => {
        try {
          await this.consoleStreamer.subscribe(payload.serverId);
          console.log(`[agent] console subscribe ${payload.serverId}`);
          ack?.({ ok: true });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.error(`[agent] console subscribe failed: ${error}`);
          ack?.({ ok: false, error });
        }
      },
    );

    this.socket.on(
      WsEvents.AgentConsoleUnsubscribe,
      async (
        payload: ConsoleSubscribePayload,
        ack?: (result: { ok: boolean; error?: string }) => void,
      ) => {
        try {
          await this.consoleStreamer.unsubscribe(payload.serverId);
          ack?.({ ok: true });
        } catch (err) {
          ack?.({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );

    this.socket.on(
      WsEvents.AgentConsoleInject,
      async (
        payload: ConsoleCommandPayload,
        ack?: (result: { ok: boolean; error?: string }) => void,
      ) => {
        try {
          await this.consoleStreamer.inject(payload.serverId, payload.command);
          ack?.({ ok: true });
        } catch (err) {
          ack?.({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.consoleStreamer.stopAll();
    this.socket?.disconnect();
    this.socket = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const beat = () => {
      this.socket?.emit(WsEvents.AgentHeartbeat, {
        hostId: this.config.HOST_ID,
        at: new Date().toISOString(),
      });
    };
    beat();
    this.heartbeatTimer = setInterval(beat, this.config.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
