import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ServerConfigBundle,
  ServerCreatePayload,
  ServerPutConfigPayload,
} from '@bannerlord-panel/shared';
import type { AgentConfig } from '../config.js';

export function serverRoot(config: AgentConfig, serverId: string): string {
  return join(config.AGENT_DATA_ROOT, 'servers', serverId);
}

function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([\]}])/g, '$1');
}

export async function ensureServerFilesystem(
  config: AgentConfig,
  payload: ServerCreatePayload,
): Promise<{ root: string; dataDir: string; wineDir: string }> {
  const root = serverRoot(config, payload.serverId);
  const dataDir = join(root, 'data');
  const wineDir = join(root, 'wineprefix');
  const savesDir = join(dataDir, 'Game Saves');
  const logsDir = join(dataDir, 'logs');

  await mkdir(savesDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(wineDir, { recursive: true });

  const serverConfig = {
    saveName: payload.saveName,
    autosaveMinutes: payload.autosaveMinutes,
    password: payload.password,
    logFile: payload.logFile,
    port: payload.gamePort,
    steam: false as const,
  };

  await writeFile(
    join(dataDir, 'server-config.json'),
    `${JSON.stringify(serverConfig, null, 2)}\n`,
    'utf8',
  );

  const modConfigPath = join(root, 'mod-config.json');
  try {
    await access(modConfigPath);
  } catch {
    await writeFile(
      modConfigPath,
      `${JSON.stringify({ difficulty: {}, modOptions: {} }, null, 2)}\n`,
      'utf8',
    );
  }

  return { root, dataDir, wineDir };
}

export async function readServerConfig(
  config: AgentConfig,
  serverId: string,
  gamePort: number,
): Promise<ServerConfigBundle> {
  const root = serverRoot(config, serverId);
  const processPath = join(root, 'data', 'server-config.json');
  const modPath = join(root, 'mod-config.json');

  let processRaw: Record<string, unknown> = {};
  try {
    processRaw = JSON.parse(
      stripJsonComments(await readFile(processPath, 'utf8')),
    ) as Record<string, unknown>;
  } catch {
    processRaw = {};
  }

  let modRaw: { difficulty?: Record<string, unknown>; modOptions?: Record<string, unknown> } =
    {};
  try {
    modRaw = JSON.parse(
      stripJsonComments(await readFile(modPath, 'utf8')),
    ) as typeof modRaw;
  } catch {
    modRaw = {};
  }

  return {
    process: {
      saveName: String(processRaw.saveName ?? 'saveauto1'),
      autosaveMinutes: Number(processRaw.autosaveMinutes ?? 5),
      password: String(processRaw.password ?? ''),
      logFile: Boolean(processRaw.logFile ?? true),
      port: gamePort,
      steam: false,
    },
    modConfig: {
      difficulty: modRaw.difficulty ?? {},
      modOptions: modRaw.modOptions ?? {},
    },
  };
}

export async function writeServerConfig(
  config: AgentConfig,
  payload: ServerPutConfigPayload,
  gamePort: number,
): Promise<ServerConfigBundle> {
  const root = serverRoot(config, payload.serverId);
  const dataDir = join(root, 'data');
  await mkdir(dataDir, { recursive: true });

  const process = {
    saveName: payload.process.saveName,
    autosaveMinutes: payload.process.autosaveMinutes,
    password: payload.process.password,
    logFile: payload.process.logFile,
    port: gamePort,
    steam: false as const,
  };

  await writeFile(
    join(dataDir, 'server-config.json'),
    `${JSON.stringify(process, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(root, 'mod-config.json'),
    `${JSON.stringify(
      {
        difficulty: payload.modConfig.difficulty,
        modOptions: payload.modConfig.modOptions,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return {
    process,
    modConfig: payload.modConfig,
  };
}
