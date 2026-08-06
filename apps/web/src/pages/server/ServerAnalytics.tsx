import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AnalyticsRange,
  ServerAnalytics,
} from '@bannerlord-panel/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 Days' },
  { id: '30d', label: 'Last 30 Days' },
];

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function chartMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 10) / 10;
}

export function ServerAnalyticsPanel({ serverId }: { serverId: string }) {
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [data, setData] = useState<ServerAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getServerAnalytics(serverId, range);
      setData(res.analytics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [serverId, range]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const chartData = useMemo(
    () =>
      (data?.series ?? []).map((p) => ({
        label: p.label,
        minutes: chartMinutes(p.totalSeconds),
        totalSeconds: p.totalSeconds,
      })),
    [data],
  );

  const maxMinutes = Math.max(1, ...chartData.map((d) => d.minutes));
  const totalPlay = data?.players.reduce((n, p) => n + p.totalSeconds, 0) ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Playtime analytics"
          description="Sessions from @DS@ names, Coop party lines, and save.json Hero/Player ids."
          action={
            <div className="flex flex-wrap gap-1">
              {RANGES.map((r) => (
                <Button
                  key={r.id}
                  size="sm"
                  variant={range === r.id ? 'primary' : 'ghost'}
                  onClick={() => setRange(r.id)}
                >
                  {r.label}
                </Button>
              ))}
            </div>
          }
        />
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted">Total playtime</p>
            <p className="mt-1 text-xl font-semibold">
              {formatDuration(totalPlay)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Players in range</p>
            <p className="mt-1 text-xl font-semibold">
              {data?.players.length ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Online now</p>
            <p className="mt-1 text-xl font-semibold">
              {data?.currentlyOnline.length
                ? data.currentlyOnline.join(', ')
                : '—'}
            </p>
          </div>
        </div>
      </Card>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Play time" description="Minutes played in each bucket" />
        <div className="px-4 pb-4 pt-2">
          {loading && !data ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : chartData.every((d) => d.minutes === 0) ? (
            <p className="text-sm text-muted">
              No playtime recorded for this range yet. Sessions start when
              `@DS@` player lists appear in the console.
            </p>
          ) : (
            <div className="flex h-52 items-end gap-1.5 border-b border-border pt-4">
              {chartData.map((d) => {
                const heightPct = (d.minutes / maxMinutes) * 100;
                return (
                  <div
                    key={d.label}
                    className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                    title={`${d.label}: ${d.minutes} min`}
                  >
                    <span className="invisible text-[10px] text-muted group-hover:visible">
                      {d.minutes > 0 ? `${d.minutes}m` : ''}
                    </span>
                    <div
                      className="w-full max-w-10 rounded-t bg-accent/90 transition-colors group-hover:bg-accent"
                      style={{ height: `${Math.max(d.minutes > 0 ? 4 : 0, heightPct)}%` }}
                    />
                    <span className="w-full truncate text-center text-[10px] text-muted">
                      {d.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Players" description="Totals for the selected range" />
          <div className="overflow-x-auto px-4 pb-4">
            {(data?.players.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">No players yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-medium">Player</th>
                    <th className="py-2 pr-3 font-medium">Party / Hero</th>
                    <th className="py-2 pr-3 font-medium">Playtime</th>
                    <th className="py-2 font-medium">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.players.map((p) => (
                    <tr
                      key={`${p.playerName}-${p.partyName ?? ''}-${p.controllerId ?? ''}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="py-2 pr-3 font-medium">{p.playerName}</td>
                      <td className="py-2 pr-3 text-muted">
                        {p.partyName ?? '—'}
                        {p.heroId ? (
                          <span className="block text-xs">{p.heroId}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">
                        {formatDuration(p.totalSeconds)}
                      </td>
                      <td className="py-2">{p.sessionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Recent sessions" description="Latest joins and leaves" />
          <div className="max-h-80 overflow-auto px-4 pb-4">
            {(data?.recentSessions.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">No sessions recorded yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data?.recentSessions.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-lg border border-border/70 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {s.playerName}
                        {s.partyName ? (
                          <span className="ml-2 text-xs font-normal text-muted">
                            {s.partyName}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          'text-xs',
                          s.leftAt ? 'text-muted' : 'text-success',
                        )}
                      >
                        {s.leftAt ? 'left' : 'online'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(s.joinedAt).toLocaleString()}
                      {s.leftAt
                        ? ` → ${new Date(s.leftAt).toLocaleString()}`
                        : ''}
                      {' · '}
                      {formatDuration(s.durationSeconds)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
