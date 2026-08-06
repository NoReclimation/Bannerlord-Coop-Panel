import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  AnalyticsRange,
  PlaytimePlayerSummary,
  PlaytimeSeriesPoint,
  PlaytimeSession,
  PlayerLeftPayload,
  PlayerPartyPayload,
  PlayerRosterEntry,
  PlayerRosterPayload,
  SavePlayerIdentity,
  ServerAnalytics,
} from '@bannerlord-panel/shared';
import { partyNameToHeroId } from '@bannerlord-panel/shared';

interface SessionRow {
  id: string;
  server_id: string;
  peer_id: number | null;
  player_name: string;
  party_name: string | null;
  hero_id: string | null;
  controller_id: string | null;
  address: string | null;
  joined_at: Date;
  left_at: Date | null;
}

interface RosterPlayer {
  id: number;
  name: string;
  state?: string;
  addr?: string;
  partyName?: string;
}

const JOINING = '(joining)';

function isPlaceholderName(name: string): boolean {
  return !name || name === JOINING || /^peer-\d+$/i.test(name);
}

function preferName(current: string, next: string): string {
  if (isPlaceholderName(next)) return current;
  if (isPlaceholderName(current)) return next;
  return next;
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
    heroId: row.hero_id,
    controllerId: row.controller_id,
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
 * Tracks open play sessions from `@DS@` roster diffs, Coop party lines, and save.json.
 */
export class PlaytimeRegistry {
  /** serverId → peerId → player */
  private readonly rosters = new Map<string, Map<number, RosterPlayer>>();
  /** serverId → partyName → save identity */
  private readonly saveByParty = new Map<string, Map<string, SavePlayerIdentity>>();
  /** serverId → peerId → partyName */
  private readonly partyByPeer = new Map<string, Map<number, string>>();

  constructor(private readonly pool: Pool) {}

  setSavePlayers(serverId: string, players: SavePlayerIdentity[]): void {
    const map = new Map<string, SavePlayerIdentity>();
    for (const p of players) {
      map.set(p.partyName, p);
    }
    this.saveByParty.set(serverId, map);
  }

  currentlyOnline(serverId: string): string[] {
    const roster = this.rosters.get(serverId);
    if (!roster) return [];
    return [...roster.values()]
      .map((p) => {
        const party = p.partyName ?? this.partyByPeer.get(serverId)?.get(p.id);
        if (party && !isPlaceholderName(p.name)) return `${p.name} (${party})`;
        return p.name;
      })
      .sort((a, b) => a.localeCompare(b));
  }

  async applyRoster(payload: PlayerRosterPayload): Promise<void> {
    const at = new Date(payload.at);
    const next = new Map<number, RosterPlayer>();
    const parties = this.partyByPeer.get(payload.serverId);

    for (const p of payload.players) {
      const partyName = parties?.get(p.id);
      next.set(p.id, {
        id: p.id,
        name: p.name,
        state: p.state,
        addr: p.addr,
        partyName,
      });
    }

    const prev = this.rosters.get(payload.serverId) ?? new Map();
    this.rosters.set(payload.serverId, next);

    for (const [peerId, player] of next) {
      const was = prev.get(peerId);
      if (!was) {
        await this.openSession(payload.serverId, player, at);
        continue;
      }
      if (was.name !== player.name || was.addr !== player.addr) {
        await this.updateOpenSession(payload.serverId, peerId, {
          playerName: preferName(was.name, player.name),
          address: player.addr,
          partyName: player.partyName,
        });
        was.name = preferName(was.name, player.name);
        was.addr = player.addr;
      }
    }
    for (const [peerId, player] of prev) {
      if (!next.has(peerId)) {
        await this.closeSession(payload.serverId, peerId, player.name, at);
      }
    }
  }

  async applyParty(payload: PlayerPartyPayload): Promise<void> {
    const map =
      this.partyByPeer.get(payload.serverId) ?? new Map<number, string>();
    this.partyByPeer.set(payload.serverId, map);

    if (payload.peerId !== undefined) {
      map.set(payload.peerId, payload.partyName);
      const roster = this.rosters.get(payload.serverId)?.get(payload.peerId);
      if (roster) roster.partyName = payload.partyName;
      await this.updateOpenSession(payload.serverId, payload.peerId, {
        partyName: payload.partyName,
      });
      return;
    }

    // CreateNewPartyVisual has party but no peer — bind to lone joining peer if possible
    const roster = this.rosters.get(payload.serverId);
    if (!roster || roster.size !== 1) return;
    const [peerId, player] = [...roster.entries()][0]!;
    if (!map.has(peerId)) {
      map.set(peerId, payload.partyName);
      player.partyName = payload.partyName;
      await this.updateOpenSession(payload.serverId, peerId, {
        partyName: payload.partyName,
      });
    }
  }

  async applyLeave(payload: PlayerLeftPayload): Promise<void> {
    const at = new Date(payload.at);
    const roster = this.rosters.get(payload.serverId);
    const known = roster?.get(payload.peerId);
    const party =
      payload.partyName ??
      known?.partyName ??
      this.partyByPeer.get(payload.serverId)?.get(payload.peerId);
    const name = preferName(
      known?.name ?? JOINING,
      known?.name ?? party ?? `peer-${payload.peerId}`,
    );
    const display = isPlaceholderName(name)
      ? party ?? `peer-${payload.peerId}`
      : name;
    roster?.delete(payload.peerId);
    this.partyByPeer.get(payload.serverId)?.delete(payload.peerId);
    await this.closeSession(
      payload.serverId,
      payload.peerId,
      display,
      at,
      party,
    );
  }

  async closeAllForServer(serverId: string, at = new Date()): Promise<void> {
    this.rosters.delete(serverId);
    this.partyByPeer.delete(serverId);
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

  private identityForParty(
    serverId: string,
    partyName: string | undefined,
  ): { heroId: string | null; controllerId: string | null } {
    if (!partyName) return { heroId: null, controllerId: null };
    const fromSave = this.saveByParty.get(serverId)?.get(partyName);
    return {
      heroId: fromSave?.heroId ?? partyNameToHeroId(partyName),
      controllerId: fromSave?.controllerId || null,
    };
  }

  private async openSession(
    serverId: string,
    player: PlayerRosterEntry & { partyName?: string },
    at: Date,
  ): Promise<void> {
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM playtime_sessions
       WHERE server_id = $1 AND peer_id = $2 AND left_at IS NULL
       LIMIT 1`,
      [serverId, player.id],
    );
    if (existing.rows[0]) return;

    const partyName =
      player.partyName ?? this.partyByPeer.get(serverId)?.get(player.id);
    const { heroId, controllerId } = this.identityForParty(serverId, partyName);

    await this.pool.query(
      `INSERT INTO playtime_sessions
        (id, server_id, peer_id, player_name, party_name, hero_id, controller_id, address, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        randomUUID(),
        serverId,
        player.id,
        player.name,
        partyName ?? null,
        heroId,
        controllerId,
        player.addr ?? null,
        at.toISOString(),
      ],
    );
  }

  private async updateOpenSession(
    serverId: string,
    peerId: number,
    patch: {
      playerName?: string;
      partyName?: string;
      address?: string;
    },
  ): Promise<void> {
    const { heroId, controllerId } = this.identityForParty(
      serverId,
      patch.partyName,
    );

    await this.pool.query(
      `UPDATE playtime_sessions
       SET player_name = CASE
             WHEN $3::text IS NOT NULL AND player_name IN ('(joining)', '') THEN $3
             WHEN $3::text IS NOT NULL AND $3 NOT IN ('(joining)', '') THEN $3
             ELSE player_name
           END,
           party_name = COALESCE($4, party_name),
           hero_id = COALESCE($5, hero_id),
           controller_id = COALESCE($6, controller_id),
           address = COALESCE($7, address)
       WHERE server_id = $1 AND peer_id = $2 AND left_at IS NULL`,
      [
        serverId,
        peerId,
        patch.playerName ?? null,
        patch.partyName ?? null,
        heroId,
        controllerId,
        patch.address ?? null,
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
    const { heroId, controllerId } = this.identityForParty(serverId, partyName);
    const result = await this.pool.query(
      `UPDATE playtime_sessions
       SET left_at = $4,
           party_name = COALESCE(party_name, $5),
           hero_id = COALESCE(hero_id, $6),
           controller_id = COALESCE(controller_id, $7),
           player_name = CASE
             WHEN player_name IN ('(joining)', '') AND $3 NOT IN ('(joining)', '') THEN $3
             ELSE player_name
           END
       WHERE server_id = $1
         AND left_at IS NULL
         AND (peer_id = $2 OR (peer_id IS NULL AND player_name = $3))`,
      [
        serverId,
        peerId,
        playerName,
        at.toISOString(),
        partyName ?? null,
        heroId,
        controllerId,
      ],
    );
    if ((result.rowCount ?? 0) > 0) return;
  }
}

function overlapSeconds(
  joinedAt: string,
  leftAt: string | null,
  from: Date,
  to: Date,
  now: Date,
): number {
  const iv = overlapInterval(joinedAt, leftAt, from, to, now);
  if (!iv) return 0;
  return Math.max(0, Math.floor((iv.end - iv.start) / 1000));
}

function overlapInterval(
  joinedAt: string,
  leftAt: string | null,
  from: Date,
  to: Date,
  now: Date,
): { start: number; end: number } | null {
  const start = Math.max(new Date(joinedAt).getTime(), from.getTime());
  const end = Math.min(
    leftAt ? new Date(leftAt).getTime() : now.getTime(),
    to.getTime(),
  );
  if (end <= start) return null;
  return { start, end };
}

/** Wall-clock seconds covered by any session (overlapping intervals merged). */
function unionCoverageSeconds(
  intervals: { start: number; end: number }[],
): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let covered = 0;
  let curStart = sorted[0]!.start;
  let curEnd = sorted[0]!.end;
  for (let i = 1; i < sorted.length; i++) {
    const iv = sorted[i]!;
    if (iv.start <= curEnd) {
      curEnd = Math.max(curEnd, iv.end);
    } else {
      covered += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    }
  }
  covered += curEnd - curStart;
  return Math.floor(covered / 1000);
}

function summarizePlayers(
  sessions: PlaytimeSession[],
  from: Date,
  to: Date,
  now: Date,
): PlaytimePlayerSummary[] {
  const map = new Map<
    string,
    {
      playerName: string;
      partyName: string | null;
      heroId: string | null;
      controllerId: string | null;
      totalSeconds: number;
      sessionCount: number;
      lastSeenAt: string;
    }
  >();

  for (const s of sessions) {
    const seconds = overlapSeconds(s.joinedAt, s.leftAt, from, to, now);
    if (seconds <= 0 && s.leftAt) continue;

    const key =
      s.controllerId ||
      s.partyName ||
      (isPlaceholderName(s.playerName) ? s.id : s.playerName);

    const cur = map.get(key) ?? {
      playerName: s.playerName,
      partyName: s.partyName,
      heroId: s.heroId,
      controllerId: s.controllerId,
      totalSeconds: 0,
      sessionCount: 0,
      lastSeenAt: s.joinedAt,
    };

    if (!isPlaceholderName(s.playerName)) {
      cur.playerName = s.playerName;
    } else if (isPlaceholderName(cur.playerName) && s.partyName) {
      cur.playerName = s.partyName;
    }
    if (s.partyName) cur.partyName = s.partyName;
    if (s.heroId) cur.heroId = s.heroId;
    if (s.controllerId) cur.controllerId = s.controllerId;

    cur.totalSeconds += seconds;
    cur.sessionCount += 1;
    const seen = s.leftAt ?? s.joinedAt;
    if (seen > cur.lastSeenAt) cur.lastSeenAt = seen;
    map.set(key, cur);
  }

  return [...map.values()]
    .filter((p) => !isPlaceholderName(p.playerName) || p.partyName)
    .map((p) => ({
      playerName: isPlaceholderName(p.playerName)
        ? p.partyName ?? p.playerName
        : p.playerName,
      partyName: p.partyName,
      heroId: p.heroId,
      controllerId: p.controllerId,
      totalSeconds: p.totalSeconds,
      sessionCount: p.sessionCount,
      lastSeenAt: p.lastSeenAt,
    }))
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
    const intervals: { start: number; end: number }[] = [];
    for (const s of sessions) {
      const iv = overlapInterval(s.joinedAt, s.leftAt, bucketStart, end, now);
      if (!iv) continue;
      const seconds = Math.floor((iv.end - iv.start) / 1000);
      if (seconds <= 0) continue;
      const label = isPlaceholderName(s.playerName)
        ? s.partyName ?? s.playerName
        : s.playerName;
      byPlayer[label] = (byPlayer[label] ?? 0) + seconds;
      intervals.push(iv);
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
      // Wall-clock coverage — concurrent players do not stack.
      totalSeconds: unionCoverageSeconds(intervals),
      byPlayer,
    });
    cursor.setTime(bucketEnd.getTime());
  }
  return points;
}
