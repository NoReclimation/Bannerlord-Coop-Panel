import { access, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import type {
  BackupRef,
  ServerBackupCreatePayload,
  ServerBackupIdPayload,
  ServerBackupReadResult,
  ServerBackupRestorePayload,
} from '@bannerlord-panel/shared';
import type { AgentConfig } from '../config.js';
import { serverRoot } from '../docker/filesystem.js';

const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;

const INCLUDE_PATHS = [
  'data/server-config.json',
  'data/Game Saves',
  'mod-config.json',
  'server-mods',
] as const;

function backupsDir(config: AgentConfig, serverId: string): string {
  return join(config.AGENT_DATA_ROOT, 'backups', serverId);
}

function backupFilePath(
  config: AgentConfig,
  serverId: string,
  backupId: string,
): string {
  return join(backupsDir(config, serverId), `${backupId}.zip`);
}

function relativeBackupPath(serverId: string, backupId: string): string {
  return `backups/${serverId}/${backupId}.zip`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates / restores / deletes server data archives under
 * `{AGENT_DATA_ROOT}/backups/<serverId>/` (outside the live server tree).
 */
export class BackupManager {
  constructor(private readonly config: AgentConfig) {}

  async create(payload: ServerBackupCreatePayload): Promise<BackupRef> {
    const root = serverRoot(this.config, payload.serverId);
    if (!(await exists(root))) {
      throw new Error('Server data directory not found');
    }

    const dir = backupsDir(this.config, payload.serverId);
    await mkdir(dir, { recursive: true });
    const dest = backupFilePath(
      this.config,
      payload.serverId,
      payload.backupId,
    );

    const zip = new AdmZip();
    let added = 0;
    for (const rel of INCLUDE_PATHS) {
      const abs = join(root, rel);
      if (!(await exists(abs))) continue;
      const info = await stat(abs);
      if (info.isDirectory()) {
        zip.addLocalFolder(abs, rel);
        added += 1;
      } else {
        const parent = rel.includes('/')
          ? rel.slice(0, rel.lastIndexOf('/'))
          : '';
        zip.addLocalFile(abs, parent);
        added += 1;
      }
    }

    if (added === 0) {
      throw new Error('Nothing to back up (no saves/config found)');
    }

    zip.writeZip(dest);
    const info = await stat(dest);

    return {
      id: payload.backupId,
      serverId: payload.serverId,
      path: dest,
      relativePath: relativeBackupPath(payload.serverId, payload.backupId),
      sizeBytes: info.size,
      createdAt: new Date().toISOString(),
      note: payload.note ?? null,
    };
  }

  async restore(payload: ServerBackupRestorePayload): Promise<void> {
    const destRoot = serverRoot(this.config, payload.serverId);
    const zipPath = backupFilePath(
      this.config,
      payload.serverId,
      payload.backupId,
    );
    if (!(await exists(zipPath))) {
      throw new Error('Backup archive not found');
    }
    await mkdir(destRoot, { recursive: true });

    for (const rel of [
      'data/server-config.json',
      'data/Game Saves',
      'mod-config.json',
      'server-mods',
    ]) {
      const abs = join(destRoot, rel);
      if (await exists(abs)) {
        await rm(abs, { recursive: true, force: true });
      }
    }
    await mkdir(join(destRoot, 'data', 'Game Saves'), { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destRoot, true);
  }

  async delete(payload: ServerBackupIdPayload): Promise<void> {
    const zipPath = backupFilePath(
      this.config,
      payload.serverId,
      payload.backupId,
    );
    if (await exists(zipPath)) {
      await rm(zipPath, { force: true });
    }
  }

  async read(payload: ServerBackupIdPayload): Promise<ServerBackupReadResult> {
    const zipPath = backupFilePath(
      this.config,
      payload.serverId,
      payload.backupId,
    );
    if (!(await exists(zipPath))) {
      throw new Error('Backup archive not found');
    }
    const info = await stat(zipPath);
    if (info.size > MAX_DOWNLOAD_BYTES) {
      const buf = await readFile(zipPath);
      return {
        backupId: payload.backupId,
        encoding: 'base64',
        content: buf.subarray(0, MAX_DOWNLOAD_BYTES).toString('base64'),
        size: info.size,
        truncated: true,
      };
    }
    const buf = await readFile(zipPath);
    return {
      backupId: payload.backupId,
      encoding: 'base64',
      content: buf.toString('base64'),
      size: info.size,
    };
  }

  async listDisk(serverId: string): Promise<string[]> {
    const dir = backupsDir(this.config, serverId);
    if (!(await exists(dir))) return [];
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith('.zip'));
  }

  resolveSafeBackupPath(serverId: string, backupId: string): string {
    const root = resolve(backupsDir(this.config, serverId));
    const file = resolve(backupFilePath(this.config, serverId, backupId));
    const rel = relative(root, file);
    if (rel.startsWith('..') || rel.includes('..')) {
      throw new Error('Path escapes backups root');
    }
    return file;
  }
}
