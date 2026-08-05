export type ServerLifecycleStatus =
  | 'created'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'unknown'
  | 'error';

export interface ServerStatus {
  id: string;
  status: ServerLifecycleStatus;
  uptimeSeconds?: number;
  lastRestartAt?: string;
}

export interface PlayerInfo {
  id: string;
  name: string;
  connectedAt?: string;
}

export interface ResourceMetrics {
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes?: number;
  diskBytes?: number;
  sampledAt: string;
}

export interface BackupRef {
  id: string;
  serverId: string;
  /** Absolute or data-root-relative path on the host. */
  path: string;
  createdAt: string;
  sizeBytes?: number;
  note?: string | null;
  /** Relative path under AGENT_DATA_ROOT (e.g. backups/<serverId>/<id>.zip). */
  relativePath?: string;
}

export interface CreateServerSpec {
  id: string;
  name: string;
  hostId: string;
  installationId: string;
  gamePort: number;
  enginePort: number;
  templateId?: string;
  saveName?: string;
  password?: string;
  autosaveMinutes?: number;
  logFile?: boolean;
}

export interface GameServerRecord {
  id: string;
  name: string;
  hostId: string;
  installationId: string;
  gameType: string;
  status: ServerLifecycleStatus;
  gamePort: number;
  enginePort: number;
  containerId?: string | null;
  containerName?: string | null;
  saveName: string;
  /** Password may be omitted in list views later; included for admin API in Phase 3. */
  password: string;
  autosaveMinutes: number;
  logFile: boolean;
  lastRestartAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Game-agnostic server operations implemented by each game adapter
 * (Bannerlord Coop first). Executed on the Management Agent.
 */
export interface IGameServerAdapter {
  create(spec: CreateServerSpec): Promise<void>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  kill(id: string): Promise<void>;
  sendConsoleCommand(id: string, cmd: string): Promise<void>;
  getStatus(id: string): Promise<ServerStatus>;
  getPlayers(id: string): Promise<PlayerInfo[]>;
  getMetrics(id: string): Promise<ResourceMetrics>;
  backup(id: string): Promise<BackupRef>;
  restore(id: string, backup: BackupRef): Promise<void>;
}
