/** Player entry from `@DS@{"ev":"players","list":[...]}`. */
export interface DsPlayerEntry {
  id: number;
  name: string;
  state?: string;
  addr?: string;
}

export interface DsPlayersEvent {
  ev: 'players';
  list: DsPlayerEntry[];
}

export type DsEvent = DsPlayersEvent;

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const DS_JSON_RE = /@DS@(\{[\s\S]*\})/;

export function stripAnsi(line: string): string {
  return line.replace(ANSI_RE, '');
}

/** Extract and parse an `@DS@{…}` payload from a console line. */
export function parseDsEvent(line: string): DsEvent | null {
  const clean = stripAnsi(line);
  const match = DS_JSON_RE.exec(clean);
  if (!match?.[1]) return null;
  try {
    const raw = JSON.parse(match[1]) as { ev?: string; list?: unknown };
    if (raw.ev !== 'players' || !Array.isArray(raw.list)) return null;
    const list: DsPlayerEntry[] = [];
    for (const item of raw.list) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = Number(row.id);
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (!Number.isFinite(id) || !name) continue;
      list.push({
        id,
        name,
        state: typeof row.state === 'string' ? row.state : undefined,
        addr: typeof row.addr === 'string' ? row.addr : undefined,
      });
    }
    return { ev: 'players', list };
  } catch {
    return null;
  }
}

/**
 * `[DedicatedServer] player disconnected: peer 1 (RemoteConnectionClose)`
 * `[Coop] Parked party "Player139226" for disconnected peer 1`
 */
export function parsePlayerDisconnect(line: string): {
  peerId: number;
  partyName?: string;
} | null {
  const clean = stripAnsi(line);
  const parked = /Parked party "([^"]+)" for disconnected peer (\d+)/i.exec(
    clean,
  );
  if (parked) {
    return {
      peerId: Number(parked[2]),
      partyName: parked[1],
    };
  }
  const disc =
    /player disconnected:\s*peer\s+(\d+)/i.exec(clean) ??
    /disconnected peer\s+(\d+)/i.exec(clean);
  if (!disc) return null;
  return { peerId: Number(disc[1]) };
}

/**
 * `[Coop] Restored party "Player139226" for reconnected peer 0`
 */
export function parsePartyRestored(line: string): {
  peerId: number;
  partyName: string;
} | null {
  const clean = stripAnsi(line);
  const match =
    /Restored party "([^"]+)" for reconnected peer (\d+)/i.exec(clean);
  if (!match) return null;
  return { partyName: match[1]!, peerId: Number(match[2]) };
}
