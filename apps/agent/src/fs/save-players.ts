import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  heroIdToPartyName,
  type SavePlayerIdentity,
} from '@bannerlord-panel/shared';
import { serverRoot } from '../docker/filesystem.js';
import type { AgentConfig } from '../config.js';

interface SaveJsonShape {
  UniqueGameId?: string;
  Players?: Array<Record<string, unknown>>;
}

function parsePlayers(raw: SaveJsonShape): SavePlayerIdentity[] {
  const out: SavePlayerIdentity[] = [];
  for (const row of raw.Players ?? []) {
    const heroId =
      typeof row.HeroId === 'string'
        ? row.HeroId
        : typeof row.heroId === 'string'
          ? row.heroId
          : '';
    const controllerId =
      typeof row.ControllerId === 'string'
        ? row.ControllerId
        : typeof row.controllerId === 'string'
          ? row.controllerId
          : '';
    if (!heroId) continue;
    const partyName = heroIdToPartyName(heroId);
    if (!partyName) continue;
    const characterName =
      typeof row.Name === 'string'
        ? row.Name
        : typeof row.name === 'string'
          ? row.name
          : typeof row.CharacterName === 'string'
            ? row.CharacterName
            : undefined;
    out.push({
      heroId,
      partyName,
      controllerId,
      characterName: characterName?.trim() || undefined,
    });
  }
  return out;
}

/**
 * Reads campaign save JSON under data/Game Saves and returns Players identities.
 * Prefers `{saveName}.json`, then `save.json`, then any *.json with a Players array.
 */
export async function readSavePlayers(
  config: AgentConfig,
  serverId: string,
  saveName: string,
): Promise<{ saveName: string; players: SavePlayerIdentity[]; path: string | null }> {
  const savesDir = join(serverRoot(config, serverId), 'data', 'Game Saves');
  const candidates = [
    join(savesDir, `${saveName}.json`),
    join(savesDir, saveName),
    join(savesDir, 'save.json'),
  ];

  for (const path of candidates) {
    try {
      const text = await readFile(path, 'utf8');
      const raw = JSON.parse(text) as SaveJsonShape;
      if (!Array.isArray(raw.Players)) continue;
      return { saveName, players: parsePlayers(raw), path };
    } catch {
      // try next
    }
  }

  try {
    const entries = await readdir(savesDir);
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.json')) continue;
      const path = join(savesDir, name);
      try {
        const text = await readFile(path, 'utf8');
        const raw = JSON.parse(text) as SaveJsonShape;
        if (!Array.isArray(raw.Players)) continue;
        if (
          raw.UniqueGameId &&
          saveName &&
          raw.UniqueGameId !== saveName &&
          name !== `${saveName}.json`
        ) {
          // Prefer matching UniqueGameId when set
          continue;
        }
        return { saveName, players: parsePlayers(raw), path };
      } catch {
        // next file
      }
    }
    // Second pass: any Players json
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.json')) continue;
      const path = join(savesDir, name);
      try {
        const text = await readFile(path, 'utf8');
        const raw = JSON.parse(text) as SaveJsonShape;
        if (!Array.isArray(raw.Players)) continue;
        return { saveName, players: parsePlayers(raw), path };
      } catch {
        // next
      }
    }
  } catch {
    // no saves dir
  }

  return { saveName, players: [], path: null };
}
