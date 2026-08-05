import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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

  const totalPlay = data?.players.reduce((n, p) => n + p.totalSeconds, 0) ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Playtime analytics"
          description="Sessions from @DS@ player lists and disconnect lines."
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
        <div className="h-64 px-2 pb-4 pt-2">
          {loading && !data ? (
            <p className="px-4 text-sm text-muted">Loading…</p>
          ) : chartData.every((d) => d.minutes === 0) ? (
            <p className="px-4 text-sm text-muted">
              No playtime recorded for this range yet. Sessions start when
              `@DS@` player lists appear in the console.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(42,58,85,0.7)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#9aa8c0', fontSize: 11 }}
                  axisLine={{ stroke: '#2a3a55' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#9aa8c0', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                  unit="m"
                />
                <Tooltip
                  cursor={{ fill: 'rgba(61,184,168,0.08)' }}
                  contentStyle={{
                    background: '#121a2b',
                    border: '1px solid #2a3a55',
                    borderRadius: 8,
                    color: '#e8eef8',
                  }}
                  formatter={(value: number) => [
                    `${value} min`,
                    'Play time',
                  ]}
                />
                <Bar
                  dataKey="minutes"
                  fill="#3db8a8"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={42}
                />
              </BarChart>
            </ResponsiveContainer>
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
                    <th className="py-2 pr-3 font-medium">Playtime</th>
                    <th className="py-2 font-medium">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.players.map((p) => (
                    <tr
                      key={p.playerName}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="py-2 pr-3 font-medium">{p.playerName}</td>
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
                      <span className="font-medium">{s.playerName}</span>
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
