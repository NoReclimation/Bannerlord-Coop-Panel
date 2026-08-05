import { access, cp, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  InstallationImportPayload,
  InstallationImportResult,
  InstallationInspectPayload,
  InstallationInspectResult,
} from '@bannerlord-panel/shared';
import type { AgentConfig } from '../config.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolvePackageRoot(sourcePath: string): Promise<string> {
  const abs = resolve(sourcePath);
  if (await exists(join(abs, 'BannerlordCoopServer.exe'))) return abs;
  const nested = join(abs, 'DedicatedServer');
  if (await exists(join(nested, 'BannerlordCoopServer.exe'))) return nested;
  return abs;
}

async function deriveMeta(packageRoot: string): Promise<{
  suggestedId: string;
  gameVersion: string;
  coopCommit: string;
  layout: string;
}> {
  let gameVersion = 'unknown';
  let coopCommit = 'unknown';
  let layout = 'layered-v1';

  const releasePath = join(packageRoot, 'release-info.txt');
  if (await exists(releasePath)) {
    const text = await readFile(releasePath, 'utf8');
    const versionMatch = text.match(/Bannerlord v([\d.]+)/i);
    const commitMatch = text.match(/commit\s+([a-f0-9]+)/i);
    if (versionMatch) gameVersion = versionMatch[1]!;
    if (commitMatch) coopCommit = commitMatch[1]!.slice(0, 7);
  }

  const layoutPath = join(packageRoot, 'archive-layout.json');
  if (await exists(layoutPath)) {
    try {
      const json = JSON.parse(await readFile(layoutPath, 'utf8')) as {
        layout?: string;
      };
      if (json.layout) layout = json.layout;
    } catch {
      // ignore
    }
  }

  return {
    suggestedId: `bannerlord-${gameVersion}-coop-${coopCommit}`,
    gameVersion,
    coopCommit,
    layout,
  };
}

/**
 * Host-side installation helpers: data-root dirs, inspect package, import copy.
 */
export class InstallationManager {
  constructor(private readonly config: AgentConfig) {}

  private installationsRoot(): string {
    return join(this.config.AGENT_DATA_ROOT, 'installations');
  }

  async ensureDirs(): Promise<{ dataRoot: string; paths: string[] }> {
    const root = this.config.AGENT_DATA_ROOT;
    const paths = [
      join(root, 'installations'),
      join(root, 'servers'),
      join(root, 'backups'),
      join(root, 'mods'),
      join(root, 'templates'),
      join(root, 'staging'),
    ];
    for (const p of paths) {
      await mkdir(p, { recursive: true });
    }
    return { dataRoot: root, paths };
  }

  async inspect(
    payload: InstallationInspectPayload,
  ): Promise<InstallationInspectResult> {
    const sourcePath = resolve(payload.sourcePath);
    if (!(await exists(sourcePath))) {
      throw new Error(`Source path not found: ${sourcePath}`);
    }

    const packageRoot = await resolvePackageRoot(sourcePath);
    const hasExe = await exists(join(packageRoot, 'BannerlordCoopServer.exe'));
    const meta = await deriveMeta(packageRoot);
    const installedPath = join(this.installationsRoot(), meta.suggestedId);
    const alreadyInstalled = await exists(
      join(installedPath, 'BannerlordCoopServer.exe'),
    );

    return {
      sourcePath,
      packageRoot,
      hasExe,
      suggestedId: meta.suggestedId,
      gameVersion: meta.gameVersion,
      coopCommit: meta.coopCommit,
      layout: meta.layout,
      alreadyInstalled,
      installedPath: alreadyInstalled ? installedPath : null,
    };
  }

  async importFromPath(
    payload: InstallationImportPayload,
  ): Promise<InstallationImportResult> {
    const inspected = await this.inspect({ sourcePath: payload.sourcePath });
    if (!inspected.hasExe) {
      throw new Error(
        'BannerlordCoopServer.exe not found (expected at package root or DedicatedServer/)',
      );
    }

    const id = (payload.installationId?.trim() || inspected.suggestedId).replace(
      /[^a-zA-Z0-9._-]/g,
      '-',
    );
    if (!id) throw new Error('Invalid installation id');

    await this.ensureDirs();
    const dest = join(this.installationsRoot(), id);
    const destExe = join(dest, 'BannerlordCoopServer.exe');

    let copied = false;
    if (resolve(inspected.packageRoot) === resolve(dest)) {
      // Already in place
      copied = false;
    } else if (await exists(destExe)) {
      // Refresh copy
      await cp(inspected.packageRoot, dest, {
        recursive: true,
        force: true,
      });
      copied = true;
    } else {
      await mkdir(dest, { recursive: true });
      await cp(inspected.packageRoot, dest, {
        recursive: true,
        force: true,
      });
      copied = true;
    }

    if (!(await exists(destExe))) {
      throw new Error('Import finished but BannerlordCoopServer.exe missing at destination');
    }

    return {
      id,
      path: dest,
      gameVersion: inspected.gameVersion,
      coopCommit: inspected.coopCommit,
      layout: inspected.layout,
      copied,
    };
  }
}
