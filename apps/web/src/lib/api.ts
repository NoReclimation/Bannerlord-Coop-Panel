import type {
  AuthUser,
  BackupRef,
  CreateScheduledTaskInput,
  FileEntry,
  FsListResult,
  FsReadResult,
  GameInstallation,
  GameServerRecord,
  HostNode,
  InstallationImportResult,
  InstallationInspectResult,
  Permission,
  ScheduledTask,
  ServerConfigBundle,
  UpdateScheduledTaskInput,
} from '@bannerlord-panel/shared';

const ACCESS_KEY = 'bp.accessToken';
const REFRESH_KEY = 'bp.refreshToken';

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type') && init.body) {
    headers.set('content-type', 'application/json');
  }
  const access = getAccessToken();
  if (access) headers.set('authorization', `Bearer ${access}`);

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && retry && getRefreshToken()) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, false);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: string | object };
      message =
        typeof body.error === 'string'
          ? body.error
          : JSON.stringify(body.error ?? message);
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  permissions: Permission[];
}

async function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const data = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).then(async (res) => {
      if (!res.ok) throw new Error('refresh failed');
      return (await res.json()) as LoginResponse;
    });
    setTokens(data.accessToken, data.refreshToken);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

export const api = {
  login(username: string, password: string) {
    return request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  me() {
    return request<{ user: AuthUser; permissions: Permission[] }>(
      '/api/auth/me',
    );
  },
  logout() {
    const refreshToken = getRefreshToken();
    return request<void>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }).finally(() => clearTokens());
  },
  listServers() {
    return request<{ servers: GameServerRecord[] }>('/api/servers');
  },
  getServer(id: string) {
    return request<{ server: GameServerRecord }>(`/api/servers/${id}`);
  },
  controlServer(id: string, action: 'start' | 'stop' | 'restart' | 'kill') {
    return request<{ server: GameServerRecord }>(
      `/api/servers/${id}/${action}`,
      { method: 'POST' },
    );
  },
  getServerConfig(id: string) {
    return request<{ config: ServerConfigBundle }>(`/api/servers/${id}/config`);
  },
  putServerConfig(id: string, config: Omit<ServerConfigBundle, 'process'> & {
    process: Omit<ServerConfigBundle['process'], 'port' | 'steam'>;
  }) {
    return request<{ config: ServerConfigBundle; server: GameServerRecord }>(
      `/api/servers/${id}/config`,
      { method: 'PUT', body: JSON.stringify(config) },
    );
  },
  listHosts() {
    return request<{ hosts: HostNode[] }>('/api/hosts');
  },
  listInstallations(hostId?: string) {
    const q = hostId ? `?hostId=${encodeURIComponent(hostId)}` : '';
    return request<{ installations: GameInstallation[] }>(
      `/api/installations${q}`,
    );
  },
  inspectInstallation(sourcePath: string, hostId?: string) {
    return request<{ inspect: InstallationInspectResult }>(
      '/api/installations/inspect',
      {
        method: 'POST',
        body: JSON.stringify({ sourcePath, hostId }),
      },
    );
  },
  importInstallation(input: {
    sourcePath: string;
    hostId?: string;
    installationId?: string;
  }) {
    return request<{
      installation: GameInstallation;
      imported: InstallationImportResult;
    }>('/api/installations/import', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  registerInstallation(input: {
    id: string;
    path: string;
    gameVersion: string;
    coopCommit?: string;
    layout?: string;
    hostId?: string;
  }) {
    return request<{ installation: GameInstallation }>('/api/installations', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  createServer(input: {
    name: string;
    installationId: string;
    hostId?: string;
    saveName?: string;
    password?: string;
    autosaveMinutes?: number;
    logFile?: boolean;
    start?: boolean;
  }) {
    return request<{ server: GameServerRecord }>('/api/servers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  deleteServer(id: string) {
    return request<void>(`/api/servers/${id}`, { method: 'DELETE' });
  },
  listFiles(serverId: string, path = '.') {
    const q = new URLSearchParams({ path });
    return request<FsListResult>(`/api/servers/${serverId}/files?${q}`);
  },
  readFile(serverId: string, path: string) {
    const q = new URLSearchParams({ path });
    return request<FsReadResult>(
      `/api/servers/${serverId}/files/read?${q}`,
    );
  },
  writeFile(
    serverId: string,
    path: string,
    content: string,
    encoding: 'utf8' | 'base64' = 'utf8',
  ) {
    return request<{ path: string; size: number }>(
      `/api/servers/${serverId}/files`,
      {
        method: 'PUT',
        body: JSON.stringify({ path, content, encoding }),
      },
    );
  },
  mkdir(serverId: string, path: string) {
    return request<{ path: string }>(`/api/servers/${serverId}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },
  renameFile(serverId: string, from: string, to: string) {
    return request<{ path: string }>(
      `/api/servers/${serverId}/files/rename`,
      { method: 'POST', body: JSON.stringify({ from, to }) },
    );
  },
  moveFile(serverId: string, from: string, to: string) {
    return request<{ path: string }>(`/api/servers/${serverId}/files/move`, {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    });
  },
  deleteFile(serverId: string, path: string) {
    const q = new URLSearchParams({ path });
    return request<void>(`/api/servers/${serverId}/files?${q}`, {
      method: 'DELETE',
    });
  },
  searchFiles(serverId: string, path: string, q: string) {
    const params = new URLSearchParams({ path, q });
    return request<{ entries: FileEntry[] }>(
      `/api/servers/${serverId}/files/search?${params}`,
    );
  },
  extractZip(serverId: string, path: string, dest?: string) {
    return request<{ path: string }>(
      `/api/servers/${serverId}/files/extract`,
      {
        method: 'POST',
        body: JSON.stringify({ path, dest }),
      },
    );
  },
  compressFiles(serverId: string, paths: string[], dest: string) {
    return request<{ path: string; size: number }>(
      `/api/servers/${serverId}/files/compress`,
      {
        method: 'POST',
        body: JSON.stringify({ paths, dest }),
      },
    );
  },
  async downloadFile(serverId: string, path: string): Promise<Blob> {
    const q = new URLSearchParams({ path });
    const headers = new Headers();
    const access = getAccessToken();
    if (access) headers.set('authorization', `Bearer ${access}`);

    let res = await fetch(
      `/api/servers/${serverId}/files/download?${q}`,
      { headers },
    );
    if (res.status === 401 && getRefreshToken()) {
      const refreshed = await refreshSession();
      if (refreshed) {
        const retryHeaders = new Headers();
        const token = getAccessToken();
        if (token) retryHeaders.set('authorization', `Bearer ${token}`);
        res = await fetch(
          `/api/servers/${serverId}/files/download?${q}`,
          { headers: retryHeaders },
        );
      }
    }
    if (!res.ok) {
      throw new Error(`Download failed (${res.status})`);
    }
    return res.blob();
  },
  listSchedules(serverId: string) {
    return request<{ schedules: ScheduledTask[] }>(
      `/api/servers/${serverId}/schedules`,
    );
  },
  createSchedule(serverId: string, input: CreateScheduledTaskInput) {
    return request<{ schedule: ScheduledTask }>(
      `/api/servers/${serverId}/schedules`,
      { method: 'POST', body: JSON.stringify(input) },
    );
  },
  updateSchedule(
    serverId: string,
    taskId: string,
    input: UpdateScheduledTaskInput,
  ) {
    return request<{ schedule: ScheduledTask }>(
      `/api/servers/${serverId}/schedules/${taskId}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
  },
  deleteSchedule(serverId: string, taskId: string) {
    return request<void>(`/api/servers/${serverId}/schedules/${taskId}`, {
      method: 'DELETE',
    });
  },
  runSchedule(serverId: string, taskId: string) {
    return request<{ schedule: ScheduledTask }>(
      `/api/servers/${serverId}/schedules/${taskId}/run`,
      { method: 'POST' },
    );
  },
  listBackups(serverId: string) {
    return request<{ backups: BackupRef[]; retentionCount: number }>(
      `/api/servers/${serverId}/backups`,
    );
  },
  createBackup(serverId: string, note?: string) {
    return request<{ backup: BackupRef }>(
      `/api/servers/${serverId}/backups`,
      {
        method: 'POST',
        body: JSON.stringify({ note }),
      },
    );
  },
  restoreBackup(
    serverId: string,
    backupId: string,
    startAfter?: boolean,
  ) {
    return request<{ backup: BackupRef; server: GameServerRecord | null }>(
      `/api/servers/${serverId}/backups/${backupId}/restore`,
      {
        method: 'POST',
        body: JSON.stringify({ startAfter }),
      },
    );
  },
  deleteBackup(serverId: string, backupId: string) {
    return request<void>(
      `/api/servers/${serverId}/backups/${backupId}`,
      { method: 'DELETE' },
    );
  },
  async downloadBackup(serverId: string, backupId: string): Promise<Blob> {
    const headers = new Headers();
    const access = getAccessToken();
    if (access) headers.set('authorization', `Bearer ${access}`);

    let res = await fetch(
      `/api/servers/${serverId}/backups/${backupId}/download`,
      { headers },
    );
    if (res.status === 401 && getRefreshToken()) {
      const refreshed = await refreshSession();
      if (refreshed) {
        const retryHeaders = new Headers();
        const token = getAccessToken();
        if (token) retryHeaders.set('authorization', `Bearer ${token}`);
        res = await fetch(
          `/api/servers/${serverId}/backups/${backupId}/download`,
          { headers: retryHeaders },
        );
      }
    }
    if (!res.ok) {
      let message = `Download failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    return res.blob();
  },
};
