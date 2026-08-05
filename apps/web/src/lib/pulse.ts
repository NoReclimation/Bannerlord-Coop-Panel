/**
 * DedicatedServer pulse lines:
 * `[DedicatedServer] pulse: … players=1 …`
 * Local copy so the web app boots even if shared dist is stale.
 */
const PLAYERS_RE = /\bplayers=(\d+)\b/i;

export function parsePulsePlayerCount(line: string): number | null {
  if (!line.includes('pulse:') || !line.includes('players=')) return null;
  const match = PLAYERS_RE.exec(line);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}
