export type AnalyticsRange = 'today' | 'yesterday' | '7d' | '30d';

export interface PlaytimeSession {
  id: string;
  serverId: string;
  peerId: number | null;
  playerName: string;
  partyName: string | null;
  heroId: string | null;
  controllerId: string | null;
  address: string | null;
  joinedAt: string;
  leftAt: string | null;
  /** Seconds; open sessions use now − joinedAt. */
  durationSeconds: number;
}

export interface PlaytimePlayerSummary {
  playerName: string;
  partyName: string | null;
  heroId: string | null;
  controllerId: string | null;
  totalSeconds: number;
  sessionCount: number;
  lastSeenAt: string;
}

export interface PlaytimeSeriesPoint {
  /** Bucket start (ISO). */
  bucket: string;
  /** Label for chart axis. */
  label: string;
  /**
   * Wall-clock seconds the server had anyone online in this bucket
   * (overlapping sessions merged — concurrent play does not stack).
   */
  totalSeconds: number;
  /** Per-player seconds in the bucket (may sum above totalSeconds). */
  byPlayer: Record<string, number>;
}

export interface ServerAnalytics {
  serverId: string;
  range: AnalyticsRange;
  from: string;
  to: string;
  players: PlaytimePlayerSummary[];
  series: PlaytimeSeriesPoint[];
  recentSessions: PlaytimeSession[];
  currentlyOnline: string[];
}
