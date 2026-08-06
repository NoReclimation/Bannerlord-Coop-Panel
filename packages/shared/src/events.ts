/** Browser ↔ API and API ↔ Agent Socket.IO / WS event names. */
export const WsEvents = {
  // Agent → API
  AgentHeartbeat: 'agent:heartbeat',
  AgentConsole: 'agent:console',
  AgentPlayerCount: 'agent:player-count',
  AgentPlayerRoster: 'agent:player-roster',
  AgentPlayerLeft: 'agent:player-left',
  AgentPlayerParty: 'agent:player-party',
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
  PlayerCount: 'server.playerCount',
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

export interface PlayerCountPayload {
  serverId: string;
  playerCount: number;
  at: string;
}

export interface PlayerRosterEntry {
  id: number;
  name: string;
  state?: string;
  addr?: string;
}

/** Full `@DS@` players list snapshot from the agent. */
export interface PlayerRosterPayload {
  serverId: string;
  players: PlayerRosterEntry[];
  at: string;
}

/** Early leave signal from disconnect / parked-party lines. */
export interface PlayerLeftPayload {
  serverId: string;
  peerId: number;
  partyName?: string;
  at: string;
}

/** Coop party bound to a peer (Restored party / create visual). */
export interface PlayerPartyPayload {
  serverId: string;
  peerId?: number;
  partyName: string;
  at: string;
}

/** One player row from campaign save.json `Players[]`. */
export interface SavePlayerIdentity {
  heroId: string;
  partyName: string;
  controllerId: string;
  /** Display name if present in the save; usually absent (names come from @DS@). */
  characterName?: string;
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
