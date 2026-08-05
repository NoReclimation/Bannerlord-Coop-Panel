/** Browser ↔ API and API ↔ Agent Socket.IO / WS event names. */
export const WsEvents = {
  // Agent → API
  AgentHeartbeat: 'agent:heartbeat',
  AgentConsole: 'agent:console',
  AgentStats: 'agent:stats',
  AgentTaskProgress: 'agent:task-progress',
  AgentServerState: 'agent:server-state',

  // API → Agent
  AgentCommand: 'agent:command',
  AgentConsoleSubscribe: 'agent:console-subscribe',
  AgentConsoleUnsubscribe: 'agent:console-unsubscribe',
  AgentConsoleInject: 'agent:console-inject',

  // Browser ↔ API (namespace /client)
  ConsoleSubscribe: 'console.subscribe',
  ConsoleUnsubscribe: 'console.unsubscribe',
  ConsoleCommand: 'console.command',
  ConsoleStatus: 'console.status',

  // API → Browser (room server:<id>)
  ServerStarted: 'server.started',
  ServerStopped: 'server.stopped',
  ConsoleLine: 'console.line',
  MetricsSample: 'metrics.sample',
  PlayerJoined: 'player.joined',
  PlayerLeft: 'player.left',
  RestartCountdown: 'restart.countdown',
  TaskProgress: 'task.progress',
} as const;

export type WsEventName = (typeof WsEvents)[keyof typeof WsEvents];

export interface ConsoleLinePayload {
  serverId: string;
  line: string;
  stream: 'stdout' | 'stderr';
  at: string;
}

export interface ConsoleSubscribePayload {
  serverId: string;
}

export interface ConsoleCommandPayload {
  serverId: string;
  command: string;
}

export interface ConsoleStatusPayload {
  serverId: string;
  subscribed: boolean;
  streaming: boolean;
  message?: string;
}

export interface AgentHeartbeatPayload {
  hostId: string;
  at: string;
}

export interface RestartCountdownPayload {
  serverId: string;
  taskId: string;
  minutes: number;
  executeAt: string;
  message: string;
}
