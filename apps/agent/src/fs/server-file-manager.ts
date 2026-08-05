import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import AdmZip from 'adm-zip';
import type {
  FileEntry,
  FsCompressPayload,
  FsListResult,
  FsReadResult,
  FsRenamePayload,
  FsSearchPayload,
  FsWritePayload,
} from '@bannerlord-panel/shared';
import type { AgentConfig } from '../config.js';
import { serverRoot } from '../docker/filesystem.js';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_BYTES = 40 * 1024 * 1024;

const TEXT_EXT = new Set([
  '.txt',
  '.json',
  '.xml',
  '.yml',
  '.yaml',
  '.md',
  '.log',
  '.cfg',
  '.ini',
  '.csv',
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
  '.css',
  '.html',
  '.sh',
  '.env',
]);

function isTextPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_EXT.has(lower.slice(dot));
}

/**
 * Safe path resolution under a server's data root.
 */
export class ServerFileManager {
  constructor(private readonly config: AgentConfig) {}

  private root(serverId: string): string {
    return resolve(serverRoot(this.config, serverId));
  }

  private resolveSafe(serverId: string, relPath: string): string {
    const root = this.root(serverId);
    const cleaned = normalize((relPath || '.').replace(/\\/g, '/')).replace(
      /^(\.\/)+/,
      '',
    );
    const absolute = resolve(root, cleaned === '.' ? '' : cleaned);
    const rel = relative(root, absolute);
    if (rel.startsWith('..') || rel === '..') {
      throw new Error('Path escapes server root');
    }
    return absolute;
  }

  private toRel(serverId: string, absolute: string): string {
    const root = this.root(serverId);
    const rel = relative(root, absolute);
    return rel.split(sep).join('/') || '.';
  }

  async list(serverId: string, relPath: string): Promise<FsListResult> {
    const dir = this.resolveSafe(serverId, relPath);
    const st = await stat(dir);
    if (!st.isDirectory()) throw new Error('Not a directory');

    const names = await readdir(dir);
    const entries: FileEntry[] = [];
    for (const name of names) {
      const full = join(dir, name);
      try {
        const info = await stat(full);
        entries.push({
          name,
          path: this.toRel(serverId, full),
          type: info.isDirectory() ? 'dir' : 'file',
          size: info.isDirectory() ? 0 : info.size,
          modifiedAt: info.mtime.toISOString(),
        });
      } catch {
        // skip unreadable
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { path: this.toRel(serverId, dir), entries };
  }

  async read(serverId: string, relPath: string): Promise<FsReadResult> {
    const file = this.resolveSafe(serverId, relPath);
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');

    if (isTextPath(relPath) && info.size <= MAX_TEXT_BYTES) {
      const content = await readFile(file, 'utf8');
      return {
        path: this.toRel(serverId, file),
        encoding: 'utf8',
        content,
        size: info.size,
      };
    }

    if (info.size > MAX_BINARY_BYTES) {
      const buf = await readFile(file);
      return {
        path: this.toRel(serverId, file),
        encoding: 'base64',
        content: buf.subarray(0, MAX_BINARY_BYTES).toString('base64'),
        size: info.size,
        truncated: true,
      };
    }

    const buf = await readFile(file);
    return {
      path: this.toRel(serverId, file),
      encoding: 'base64',
      content: buf.toString('base64'),
      size: info.size,
    };
  }

  async write(payload: FsWritePayload): Promise<{ path: string; size: number }> {
    const file = this.resolveSafe(payload.serverId, payload.path);
    await mkdir(dirname(file), { recursive: true });
    const buf =
      payload.encoding === 'base64'
        ? Buffer.from(payload.content, 'base64')
        : Buffer.from(payload.content, 'utf8');
    if (buf.length > MAX_BINARY_BYTES) {
      throw new Error(`File exceeds ${MAX_BINARY_BYTES} byte limit`);
    }
    await writeFile(file, buf);
    return { path: this.toRel(payload.serverId, file), size: buf.length };
  }

  async mkdir(serverId: string, relPath: string): Promise<{ path: string }> {
    const dir = this.resolveSafe(serverId, relPath);
    await mkdir(dir, { recursive: true });
    return { path: this.toRel(serverId, dir) };
  }

  async rename(payload: FsRenamePayload): Promise<{ path: string }> {
    const from = this.resolveSafe(payload.serverId, payload.from);
    const to = this.resolveSafe(payload.serverId, payload.to);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    return { path: this.toRel(payload.serverId, to) };
  }

  async move(payload: FsRenamePayload): Promise<{ path: string }> {
    return this.rename(payload);
  }

  async delete(serverId: string, relPath: string): Promise<void> {
    const target = this.resolveSafe(serverId, relPath);
    if (target === this.root(serverId)) {
      throw new Error('Cannot delete server root');
    }
    await rm(target, { recursive: true, force: true });
  }

  async search(payload: FsSearchPayload): Promise<{ entries: FileEntry[] }> {
    const start = this.resolveSafe(payload.serverId, payload.path);
    const query = payload.query.trim().toLowerCase();
    if (!query) return { entries: [] };

    const results: FileEntry[] = [];
    const walk = async (dir: string) => {
      const names = await readdir(dir);
      for (const name of names) {
        const full = join(dir, name);
        let info;
        try {
          info = await stat(full);
        } catch {
          continue;
        }
        if (name.toLowerCase().includes(query)) {
          results.push({
            name,
            path: this.toRel(payload.serverId, full),
            type: info.isDirectory() ? 'dir' : 'file',
            size: info.isDirectory() ? 0 : info.size,
            modifiedAt: info.mtime.toISOString(),
          });
        }
        if (info.isDirectory() && results.length < 200) {
          await walk(full);
        }
        if (results.length >= 200) return;
      }
    };

    const st = await stat(start);
    if (st.isDirectory()) await walk(start);
    return { entries: results };
  }

  async extractZip(
    serverId: string,
    relPath: string,
    destRel?: string,
  ): Promise<{ path: string }> {
    const zipPath = this.resolveSafe(serverId, relPath);
    const dest = this.resolveSafe(
      serverId,
      destRel ?? dirname(this.toRel(serverId, zipPath)),
    );
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(dest, true);
    return { path: this.toRel(serverId, dest) };
  }

  async compress(payload: FsCompressPayload): Promise<{ path: string; size: number }> {
    const dest = this.resolveSafe(payload.serverId, payload.dest);
    await mkdir(dirname(dest), { recursive: true });
    const zip = new AdmZip();

    for (const rel of payload.paths) {
      const abs = this.resolveSafe(payload.serverId, rel);
      const info = await stat(abs);
      const entryName = this.toRel(payload.serverId, abs);
      if (info.isDirectory()) {
        zip.addLocalFolder(abs, entryName === '.' ? undefined : entryName);
      } else {
        zip.addLocalFile(abs, dirname(entryName) === '.' ? '' : dirname(entryName));
      }
    }

    zip.writeZip(dest);
    const info = await stat(dest);
    return { path: this.toRel(payload.serverId, dest), size: info.size };
  }
}
