import { access, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_MODULE_ORDER,
  isRequiredModuleId,
  type ModpackPreset,
  type ModpacksDeletePayload,
  type ModpacksPutPayload,
  type ModulesPutConfigPayload,
  type ModulesScanPayload,
  type ModulesScanResult,
  type ScannedModule,
  type ServerModulesConfig,
} from '@bannerlord-panel/shared';
import type { AgentConfig } from '../config.js';
import { serverRoot } from '../docker/filesystem.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function attrValue(xml: string, tag: string, attr = 'value'): string | undefined {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["']`,
    'i',
  );
  return re.exec(xml)?.[1];
}

function parseDependedModuleIds(xml: string): string[] {
  const ids: string[] = [];
  const re = /<DependedModule\b[^>]*\bId\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    if (match[1]) ids.push(match[1]);
  }
  return ids;
}

async function parseModuleDir(
  dir: string,
  folderName: string,
  source: ScannedModule['source'],
): Promise<ScannedModule | null> {
  const subModulePath = join(dir, 'SubModule.xml');
  if (!(await exists(subModulePath))) return null;

  const xml = await readFile(subModulePath, 'utf8');
  // Bannerlord `_MODULES_` tokens match the Modules folder name.
  const id = folderName;
  const name = attrValue(xml, 'Name') ?? attrValue(xml, 'Id') ?? folderName;
  const version = attrValue(xml, 'Version');
  const dependencies = parseDependedModuleIds(xml);

  return {
    id,
    name,
    version,
    dependencies,
    source,
    path: dir,
    required: isRequiredModuleId(id),
  };
}

async function scanModulesDir(
  modulesRoot: string,
  source: ScannedModule['source'],
): Promise<ScannedModule[]> {
  if (!(await exists(modulesRoot))) return [];
  const entries = await readdir(modulesRoot, { withFileTypes: true });
  const modules: ScannedModule[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(modulesRoot, entry.name);
    const parsed = await parseModuleDir(dir, entry.name, source);
    if (parsed) modules.push(parsed);
  }
  return modules;
}

function mergeModules(builtin: ScannedModule[], global: ScannedModule[]): ScannedModule[] {
  const byId = new Map<string, ScannedModule>();
  for (const mod of builtin) byId.set(mod.id, mod);
  for (const mod of global) {
    // Global mods override same Id only when not a required builtin.
    const existing = byId.get(mod.id);
    if (existing?.required) continue;
    byId.set(mod.id, mod);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function validateOrderedIds(
  enabledOrderedIds: string[],
  known: Map<string, ScannedModule>,
): void {
  if (!Array.isArray(enabledOrderedIds) || enabledOrderedIds.length === 0) {
    throw new Error('enabledOrderedIds must be a non-empty array');
  }

  const seen = new Set<string>();
  for (const id of enabledOrderedIds) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Module id must be a non-empty string');
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate module id in load order: ${id}`);
    }
    seen.add(id);
    if (!known.has(id)) {
      throw new Error(`Unknown module id: ${id}`);
    }
  }

  for (const required of known.values()) {
    if (required.required && !seen.has(required.id)) {
      throw new Error(`Required module must stay enabled: ${required.id}`);
    }
  }

  const index = new Map(enabledOrderedIds.map((id, i) => [id, i]));
  for (const id of enabledOrderedIds) {
    const mod = known.get(id)!;
    for (const dep of mod.dependencies) {
      if (!seen.has(dep)) continue;
      const depIdx = index.get(dep)!;
      const modIdx = index.get(id)!;
      if (depIdx > modIdx) {
        throw new Error(
          `Dependency order violated: ${dep} must load before ${id}`,
        );
      }
    }
  }
}

function defaultEnabledIds(modules: ScannedModule[]): string[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const ordered: string[] = [];
  for (const id of DEFAULT_MODULE_ORDER) {
    if (byId.has(id)) ordered.push(id);
  }
  for (const mod of modules) {
    if (mod.required && !ordered.includes(mod.id)) ordered.push(mod.id);
  }
  return ordered.length > 0 ? ordered : modules.filter((m) => m.required).map((m) => m.id);
}

export function modsRoot(config: AgentConfig): string {
  return join(config.AGENT_DATA_ROOT, 'mods');
}

export function modpacksRoot(config: AgentConfig): string {
  return join(config.AGENT_DATA_ROOT, 'modpacks');
}

export function modulesConfigPath(config: AgentConfig, serverId: string): string {
  return join(serverRoot(config, serverId), 'modules.json');
}

/**
 * Host-side Bannerlord module discovery + per-instance load order.
 */
export class ModulesManager {
  constructor(private readonly config: AgentConfig) {}

  async ensureDirs(): Promise<void> {
    await mkdir(modsRoot(this.config), { recursive: true });
    await mkdir(modpacksRoot(this.config), { recursive: true });
  }

  async scan(payload: ModulesScanPayload = {}): Promise<ModulesScanResult> {
    await this.ensureDirs();

    let installationPath = payload.installationPath;
    if (!installationPath && payload.serverId) {
      // Caller may omit install path; scan globals only + any modules.json context.
      installationPath = undefined;
    }

    const builtinRoot = installationPath
      ? join(resolve(installationPath), 'engine', 'Modules')
      : null;
    const builtin = builtinRoot
      ? await scanModulesDir(builtinRoot, 'builtin')
      : [];
    const global = await scanModulesDir(modsRoot(this.config), 'global');
    return { modules: mergeModules(builtin, global) };
  }

  async getConfig(
    serverId: string,
    installationPath?: string,
  ): Promise<ServerModulesConfig> {
    await this.ensureDirs();
    const path = modulesConfigPath(this.config, serverId);
    if (await exists(path)) {
      try {
        const raw = JSON.parse(await readFile(path, 'utf8')) as ServerModulesConfig;
        if (Array.isArray(raw.enabledOrderedIds) && raw.enabledOrderedIds.length > 0) {
          return { enabledOrderedIds: raw.enabledOrderedIds.map(String) };
        }
      } catch {
        // fall through to default
      }
    }

    const { modules } = await this.scan({ installationPath, serverId });
    const config: ServerModulesConfig = {
      enabledOrderedIds: defaultEnabledIds(modules),
    };
    if (config.enabledOrderedIds.length > 0) {
      try {
        await this.putConfig({ serverId, config }, installationPath);
      } catch {
        // Validation may fail if required modules are missing from disk.
      }
    }
    return config;
  }

  async putConfig(
    payload: ModulesPutConfigPayload,
    installationPath?: string,
  ): Promise<ServerModulesConfig> {
    await this.ensureDirs();
    const { modules } = await this.scan({
      installationPath,
      serverId: payload.serverId,
    });
    const known = new Map(modules.map((m) => [m.id, m]));
    validateOrderedIds(payload.config.enabledOrderedIds, known);

    const config: ServerModulesConfig = {
      enabledOrderedIds: [...payload.config.enabledOrderedIds],
    };
    const root = serverRoot(this.config, payload.serverId);
    await mkdir(root, { recursive: true });
    await writeFile(
      modulesConfigPath(this.config, payload.serverId),
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8',
    );
    // Flat inventory token (TaleWorlds-style). BannerlordCoopServer.exe does
    // not accept this as CLI argv — entrypoint ignores it; binds still apply.
    const modulesArg =
      config.enabledOrderedIds.length > 0
        ? `_MODULES_*${config.enabledOrderedIds.join('*')}*_MODULES_`
        : '';
    await writeFile(
      join(root, 'modules.arg'),
      modulesArg ? `${modulesArg}\n` : '',
      'utf8',
    );
    return config;
  }

  /**
   * Global mod folders to RO-bind into the container for the given load order.
   */
  async globalBindsFor(
    serverId: string,
    installationPath?: string,
  ): Promise<string[]> {
    const config = await this.getConfig(serverId, installationPath);
    const { modules } = await this.scan({ installationPath, serverId });
    const byId = new Map(modules.map((m) => [m.id, m]));
    const binds: string[] = [];
    for (const id of config.enabledOrderedIds) {
      const mod = byId.get(id);
      if (!mod || mod.source !== 'global') continue;
      binds.push(`${mod.path}:/opt/bannerlord/engine/Modules/${id}:ro`);
    }
    return binds;
  }

  async listModpacks(): Promise<ModpackPreset[]> {
    await this.ensureDirs();
    const root = modpacksRoot(this.config);
    const entries = await readdir(root, { withFileTypes: true });
    const packs: ModpackPreset[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(
          await readFile(join(root, entry.name), 'utf8'),
        ) as ModpackPreset;
        if (raw.id && raw.name && Array.isArray(raw.enabledOrderedIds)) {
          packs.push({
            id: String(raw.id),
            name: String(raw.name),
            enabledOrderedIds: raw.enabledOrderedIds.map(String),
          });
        }
      } catch {
        // skip corrupt
      }
    }
    return packs.sort((a, b) => a.name.localeCompare(b.name));
  }

  async putModpack(payload: ModpacksPutPayload): Promise<ModpackPreset> {
    await this.ensureDirs();
    const name = payload.name.trim();
    if (!name) throw new Error('Modpack name is required');
    if (
      !Array.isArray(payload.enabledOrderedIds) ||
      payload.enabledOrderedIds.length === 0
    ) {
      throw new Error('enabledOrderedIds must be a non-empty array');
    }

    const id = payload.id?.trim() || randomUUID();
    const pack: ModpackPreset = {
      id,
      name,
      enabledOrderedIds: payload.enabledOrderedIds.map(String),
    };
    await writeFile(
      join(modpacksRoot(this.config), `${id}.json`),
      `${JSON.stringify(pack, null, 2)}\n`,
      'utf8',
    );
    return pack;
  }

  async deleteModpack(payload: ModpacksDeletePayload): Promise<void> {
    const id = payload.id.trim();
    if (!id) throw new Error('Modpack id is required');
    const path = join(modpacksRoot(this.config), `${id}.json`);
    if (!(await exists(path))) {
      throw new Error(`Modpack not found: ${id}`);
    }
    await unlink(path);
  }
}
