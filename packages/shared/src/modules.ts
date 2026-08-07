/** Bannerlord Modules / load-order types (SubModule.xml model). */

export type ModuleSource = 'builtin' | 'global';

export interface ScannedModule {
  /** Folder name / SubModule Id used in `_MODULES_`. */
  id: string;
  name: string;
  version?: string;
  dependencies: string[];
  source: ModuleSource;
  /** Absolute path on the agent host. */
  path: string;
  /** Built-in modules that must stay enabled for Coop. */
  required?: boolean;
}

export interface ServerModulesConfig {
  /** Enabled modules in load order (first = earliest). */
  enabledOrderedIds: string[];
}

export interface ModpackPreset {
  id: string;
  name: string;
  enabledOrderedIds: string[];
}

/** Default Coop dedicated load order when no modules.json exists. */
export const DEFAULT_MODULE_ORDER = [
  'Bannerlord.Harmony',
  'Native',
  'SandBoxCore',
  'SandBox',
  'Coop',
  'DedicatedServer.Windows',
] as const;

/** Module Ids that cannot be disabled. */
export const REQUIRED_MODULE_IDS = [
  'Native',
  'SandBoxCore',
  'SandBox',
  'Coop',
  'DedicatedServer.Windows',
] as const;

export function isRequiredModuleId(id: string): boolean {
  return (REQUIRED_MODULE_IDS as readonly string[]).includes(id);
}
