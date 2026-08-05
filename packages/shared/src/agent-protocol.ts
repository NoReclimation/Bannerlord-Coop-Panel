/** Agent ↔ API command protocol (Socket.IO acks). */

export type AgentCommandAction =
  | 'server.create'
  | 'server.start'
  | 'server.stop'
  | 'server.restart'
  | 'server.kill'
  | 'server.delete'
  | 'server.status'
  | 'server.getConfig'
  | 'server.putConfig'
  | 'server.backup'
  | 'server.restoreBackup'
  | 'server.deleteBackup'
  | 'server.readBackup'
  | 'installation.ensureDirs'
  | 'installation.inspect'
  | 'installation.import'
  | 'fs.list'
  | 'fs.read'
  | 'fs.write'
  | 'fs.mkdir'
  | 'fs.rename'
  | 'fs.move'
  | 'fs.delete'
  | 'fs.search'
  | 'fs.extractZip'
  | 'fs.compress';

export interface AgentCommandRequest {
  requestId: string;
  action: AgentCommandAction;
  payload: unknown;
}

export interface AgentCommandResponse {
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ServerCreatePayload {
  serverId: string;
  name: string;
  installationId: string;
  installationPath: string;
  gamePort: number;
  enginePort: number;
  saveName: string;
  password: string;
  autosaveMinutes: number;
  logFile: boolean;
}

export interface ServerIdPayload {
  serverId: string;
}

/** start / restart — ports let the agent heal Docker publish mappings. */
export interface ServerLifecyclePayload {
  serverId: string;
  gamePort: number;
  enginePort: number;
}

export interface ServerCreateResult {
  containerId: string;
  containerName: string;
  dataPath: string;
}

export interface ServerRuntimeStatus {
  serverId: string;
  containerId?: string;
  dockerState?: string;
  running: boolean;
}

export interface ServerConfigBundle {
  process: {
    saveName: string;
    autosaveMinutes: number;
    password: string;
    logFile: boolean;
    port: number;
    steam: false;
  };
  modConfig: {
    difficulty: Record<string, unknown>;
    modOptions: Record<string, unknown>;
  };
}

export interface ServerPutConfigPayload {
  serverId: string;
  process: {
    saveName: string;
    autosaveMinutes: number;
    password: string;
    logFile: boolean;
  };
  modConfig: {
    difficulty: Record<string, unknown>;
    modOptions: Record<string, unknown>;
  };
}

export interface ServerBackupCreatePayload {
  serverId: string;
  backupId: string;
  note?: string;
}

export interface ServerBackupIdPayload {
  serverId: string;
  backupId: string;
}

export interface ServerBackupRestorePayload {
  serverId: string;
  backupId: string;
}

export interface ServerBackupReadResult {
  backupId: string;
  encoding: 'base64';
  content: string;
  size: number;
  truncated?: boolean;
}

/** Default max backups retained per server after create. */
export const DEFAULT_BACKUP_RETENTION = 10;

export interface InstallationInspectPayload {
  sourcePath: string;
}

export interface InstallationInspectResult {
  sourcePath: string;
  packageRoot: string;
  hasExe: boolean;
  suggestedId: string;
  gameVersion: string;
  coopCommit: string;
  layout: string;
  alreadyInstalled: boolean;
  installedPath: string | null;
}

export interface InstallationImportPayload {
  sourcePath: string;
  /** Override derived id when provided. */
  installationId?: string;
}

export interface InstallationImportResult {
  id: string;
  path: string;
  gameVersion: string;
  coopCommit: string;
  layout: string;
  copied: boolean;
}
