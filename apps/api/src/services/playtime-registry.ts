import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  AnalyticsRange,
  PlaytimePlayerSummary,
  PlaytimeSeriesPoint,
  PlaytimeSession,
  PlayerLeftPayload,
  PlayerRosterEntry,
  PlayerRosterPayload,
  ServerAnalytics,
} from '@bannerlord-panel/shared';

interface SessionRow {
  id: string;
  server_id: string;
  peer_id: number | null;
  player_name: string;
  party_name: string | null;
  address: string | null;
  joined_at: Date;
  left_at: Date | null;
}

interface RosterPlayer {
  id: number;
  name: string;
  state?: string;
  addr?: string;
}

function durationSeconds(joinedAt: Date, leftAt: Date | null, now = new Date()): number {
  const end = leftAt ?? now;
  return Math.max(0, Math.floor((end.getTime() - joinedAt.getTime()) / 1000));
}

function toSession(row: SessionRow, now = new Date()): PlaytimeSession {
  return {
    id: row.id,
    serverId: row.server_id,
    peerId: row.peer_id,
    playerName: row.player_name,
    partyName: row.party_name,
    address: row.address,
    joinedAt: row.joined_at.toISOString(),
    leftAt: row.left_at?.toISOString() ?? null,
    durationSeconds: durationSeconds(row.joined_at, row.left_at, now),
  };
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function rangeBounds(
  range: AnalyticsRange,
  now = new Date(),
): { from: Date; to: Date; bucket: 'hour' | 'day' } {
  const to = new Date(now);
  if (range === 'today') {
    return { from: startOfLocalDay(now), to, bucket: 'hour' };
  }
  if (range === 'yesterday') {
    const from = startOfLocalDay(now);
    from.setDate(from.getDate() - 1);
    const end = startOfLocalDay(now);
    return { from, to: end, bucket: 'hour' };
  }
  if (range === '7d') {
    const from = startOfLocalDay(now);
    from.setDate(from.getDate() - 6);
    return { from, to, bucket: 'day' };
  }
  const from = startOfLocalDay(now);
  from.setDate(from.getDate() - 29);
  return { from, to, bucket: 'day' };
}

/**
 * Tracks open play sessions from `@DS@` roster diffs and disconnect lines.
 */
export class PlaytimeRegistry {
  /** serverId → peerId → player */
  private readonly rosters = new Map<string, Map<number, RosterPlayer>>();

  constructor(private readonly pool: Pool) {}

  currentlyOnline(serverId: string): string[] {
    const roster = this.rosters.get(serverId);
    if (!roster) return [];
    return [...roster.values()].map((p) => p.name).sort((a, b) => a.localeCompare(b));
  }

  async applyRoster(payload: PlayerRosterPayload): Promise<void> {
    const at = new Date(payload.at);
    const next = new Map<number, RosterPlayer>();
    for (const p of payload.players) {
      next.set(p.id, {
        id: p.id,
        name: p.name,
        state: p.state,
        addr: p.addr,
      });
    }

    const prev = this.rosters.get(payload.serverId) ?? new Map();
    this.rosters.set(payload.serverId, next);

    for (const [peerId, player] of next) {
      if (!prev.has(peerId)) {
        await this.openSession(payload.serverId, player, at);
      }
    }
    for (const [peerId, player] of prev) {
      if (!next.has(peerId)) {
        await this.closeSession(payload.serverId, peerId, player.name, at);
      }
    }
  }

  async applyLeave(payload: PlayerLeftPayload): Promise<void> {
    const at = new Date(payload.at);
    const roster = this.rosters.get(payload.serverId);
    const known = roster?.get(payload.peerId);
    const name = known?.name ?? payload.partyName ?? `peer-${payload.peerId}`;
    roster?.delete(payload.peerId);
    await this.closeSession(
      payload.serverId,
      payload.peerId,
      name,
      at,
      payload.partyName ?? known?.name,
    );
  }

  async closeAllForServer(serverId: string, at = new Date()): Promise<void> {
    this.rosters.delete(serverId);
    await this.pool.query(
      `UPDATE playtime_sessions
       SET left_at = $2
       WHERE server_id = $1 AND left_at IS NULL`,
      [serverId, at.toISOString()],
    );
  }

  async getAnalytics(
    serverId: string,
    range: AnalyticsRange,
  ): Promise<ServerAnalytics> {
    const now = new Date();
    const { from, to, bucket } = rangeBounds(range, now);
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT * FROM playtime_sessions
       WHERE server_id = $1
         AND joined_at < $3
         AND (left_at IS NULL OR left_at > $2)
       ORDER BY joined_at DESC`,
      [serverId, from.toISOString(), to.toISOString()],
    );

    const sessions = rows.map((r) => toSession(r, now));
    const players = summarizePlayers(sessions, from, to, now);
    const series = buildSeries(sessions, from, to, bucket, now);

    const { rows: recentRows } = await this.pool.query<SessionRow>(
      `SELECT * FROM playtime_sessions
       WHERE server_id = $1
       ORDER BY joined_at DESC
       LIMIT 40`,
      [serverId],
    );

    return {
      serverId,
      range,
      from: from.toISOString(),
      to: to.toISOString(),
      players,
      series,
      recentSessions: recentRows.map((r) => toSession(r, now)),
      currentlyOnline: this.currentlyOnline(serverId),
    };
  }

  private async openSession(
    serverId: string,
    player: PlayerRosterEntry,
    at: Date,
  ): Promise<void> {
    // Avoid duplicate open rows for the same peer
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM playtime_sessions
       WHERE server_id = $1 AND peer_id = $2 AND left_at IS NULL
       LIMIT 1`,
      [serverId, player.id],
    );
    if (existing.rows[0]) return;

    await this.pool.query(
      `INSERT INTO playtime_sessions
        (id, server_id, peer_id, player_name, party_name, address, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        serverId,
        player.id,
        player.name,
        null,
        player.addr ?? null,
        at.toISOString(),
      ],
    );
  }

  private async closeSession(
    serverId: string,
    peerId: number,
    playerName: string,
    at: Date,
    partyName?: string,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE playtime_sessions
       SET left_at = $4,
           party_name = COALESCE(party_name, $5)
       WHERE server_id = $1
         AND left_at IS NULL
         AND (peer_id = $2 OR (peer_id IS NULL AND player_name = $3))`,
      [serverId, peerId, playerName, at.toISOString(), partyName ?? null],
    );
    if ((result.rowCount ?? 0) > 0) return;

    // Disconnect arrived before roster join was persisted — ignore
  }
}

function overlapSeconds(
  joinedAt: string,
  leftAt: string | null,
  from: Date,
  to: Date,
  now: Date,
): number {
  const start = Math.max(new Date(joinedAt).getTime(), from.getTime());
  const end = Math.min(
    leftAt ? new Date(leftAt).getTime() : now.getTime(),
    to.getTime(),
  );
  return Math.max(0, Math.floor((end - start) / 1000));
}

function summarizePlayers(
  sessions: PlaytimeSession[],
  from: Date,
  to: Date,
  now: Date,
): PlaytimePlayerSummary[] {
  const map = new Map<
    string,
    { totalSeconds: number; sessionCount: number; lastSeenAt: string }
  >();
  for (const s of sessions) {
    const seconds = overlapSeconds(s.joinedAt, s.leftAt, from, to, now);
    if (seconds <= 0 && s.leftAt) continue;
    const cur = map.get(s.playerName) ?? {
      totalSeconds: 0,
      sessionCount: 0,
      lastSeenAt: s.joinedAt,
    };
    cur.totalSeconds += seconds;
    cur.sessionCount += 1;
    const seen = s.leftAt ?? s.joinedAt;
    if (seen > cur.lastSeenAt) cur.lastSeenAt = seen;
    map.set(s.playerName, cur);
  }
  return [...map.entries()]
    .map(([playerName, v]) => ({ playerName, ...v }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

function buildSeries(
  sessions: PlaytimeSession[],
  from: Date,
  to: Date,
  bucket: 'hour' | 'day',
  now: Date,
): PlaytimeSeriesPoint[] {
  const points: PlaytimeSeriesPoint[] = [];
  const cursor = new Date(from);
  if (bucket === 'hour') {
    cursor.setMinutes(0, 0, 0);
  } else {
    cursor.setHours(0, 0, 0, 0);
  }

  while (cursor < to) {
    const bucketStart = new Date(cursor);
    const bucketEnd = new Date(cursor);
    if (bucket === 'hour') {
      bucketEnd.setHours(bucketEnd.getHours() + 1);
    } else {
      bucketEnd.setDate(bucketEnd.getDate() + 1);
    }
    const end = bucketEnd > to ? to : bucketEnd;
    const byPlayer: Record<string, number> = {};
    let totalSeconds = 0;
    for (const s of sessions) {
      const seconds = overlapSeconds(
        s.joinedAt,
        s.leftAt,
        bucketStart,
        end,
        now,
      );
      if (seconds <= 0) continue;
      byPlayer[s.playerName] = (byPlayer[s.playerName] ?? 0) + seconds;
      totalSeconds += seconds;
    }
    points.push({
      bucket: bucketStart.toISOString(),
      label:
        bucket === 'hour'
          ? bucketStart.toLocaleTimeString([], {
              hour: 'numeric',
            })
          : bucketStart.toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
            }),
      totalSeconds,
      byPlayer,
    });
    cursor.setTime(bucketEnd.getTime());
  }
  return points;
}
