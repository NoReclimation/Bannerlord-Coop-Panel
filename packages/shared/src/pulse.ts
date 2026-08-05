/**
 * DedicatedServer pulse lines look like:
 * `[DedicatedServer] pulse: time=… timeMode=Stop players=1 parties=1551 …`
 */
const PLAYERS_RE = /\bplayers=(\d+)\b/i;

export function parsePulsePlayerCount(line: string): number | null {
  if (!line.includes('pulse:') || !line.includes('players=')) return null;
  const match = PLAYERS_RE.exec(line);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}
