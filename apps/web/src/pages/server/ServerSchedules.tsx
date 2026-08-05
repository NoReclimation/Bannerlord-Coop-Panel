import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  CreateScheduledTaskInput,
  ScheduleAction,
  ScheduleKind,
  ScheduledTask,
} from '@bannerlord-panel/shared';
import {
  DEFAULT_COUNTDOWN_MESSAGE,
  DEFAULT_RESTART_COUNTDOWN,
} from '@bannerlord-panel/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function scheduleSummary(task: ScheduledTask): string {
  if (task.scheduleKind === 'cron') return `cron ${task.cronExpr ?? ''}`;
  if (task.scheduleKind === 'interval') {
    return `every ${task.intervalMinutes ?? '?'} min`;
  }
  return `once at ${formatWhen(task.runAt)}`;
}

const emptyForm = (): CreateScheduledTaskInput & {
  countdownText: string;
  command: string;
} => ({
  name: '',
  enabled: true,
  scheduleKind: 'cron',
  cronExpr: '0 6 * * *',
  intervalMinutes: 60,
  runAt: '',
  action: 'restart',
  command: '',
  countdownText: DEFAULT_RESTART_COUNTDOWN.join(', '),
  countdownMessage: DEFAULT_COUNTDOWN_MESSAGE,
});

export function ServerSchedules({ serverId }: { serverId: string }) {
  const { can } = useAuth();
  const canControl = can('servers:control');
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api.listSchedules(serverId);
      setTasks(data.schedules);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules');
    } finally {
      setBusy(false);
    }
  }, [serverId]);

  useEffect(() => {
    void load();
  }, [load]);

  function parseCountdown(text: string): number[] {
    return text
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!canControl) return;
    setBusy(true);
    setError(null);
    try {
      const input: CreateScheduledTaskInput = {
        name: form.name.trim(),
        enabled: form.enabled,
        scheduleKind: form.scheduleKind,
        action: form.action,
        cronExpr:
          form.scheduleKind === 'cron' ? form.cronExpr || null : null,
        intervalMinutes:
          form.scheduleKind === 'interval'
            ? form.intervalMinutes ?? null
            : null,
        runAt: form.scheduleKind === 'once' ? form.runAt || null : null,
        payload:
          form.action === 'command'
            ? { command: form.command.trim() }
            : {},
        countdownMinutes:
          form.action === 'restart' ? parseCountdown(form.countdownText) : [],
        countdownMessage: form.countdownMessage,
      };
      await api.createSchedule(serverId, input);
      setForm(emptyForm());
      setStatus('Schedule created');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(task: ScheduledTask) {
    if (!canControl) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateSchedule(serverId, task.id, {
        enabled: !task.enabled,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(task: ScheduledTask) {
    if (!canControl) return;
    if (!window.confirm(`Delete schedule "${task.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteSchedule(serverId, task.id);
      setStatus('Schedule deleted');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRun(task: ScheduledTask) {
    if (!canControl) return;
    if (!window.confirm(`Run "${task.name}" now (skips countdown)?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.runSchedule(serverId, task.id);
      setStatus('Schedule ran');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Schedules"
          description="Cron, interval, or one-shot tasks. Restart actions can broadcast countdown warnings before executing. Times use UTC for cron."
          action={
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          }
        />
        <div className="overflow-x-auto p-4">
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">When</th>
                <th className="px-2 py-2 font-medium">Action</th>
                <th className="px-2 py-2 font-medium">Next</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-2 py-8 text-center text-muted"
                  >
                    {busy ? 'Loading…' : 'No schedules yet'}
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr
                    key={task.id}
                    className="border-t border-border align-top"
                  >
                    <td className="px-2 py-2 font-medium">{task.name}</td>
                    <td className="px-2 py-2 text-muted">
                      {scheduleSummary(task)}
                    </td>
                    <td className="px-2 py-2">
                      {task.action}
                      {task.action === 'command' && task.payload.command
                        ? `: ${task.payload.command}`
                        : ''}
                      {task.action === 'restart' &&
                      task.countdownMinutes.length > 0
                        ? ` (T-${task.countdownMinutes.join('/')})`
                        : ''}
                    </td>
                    <td className="px-2 py-2 text-muted">
                      {formatWhen(task.nextRunAt)}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={
                          task.enabled ? 'text-success' : 'text-muted'
                        }
                      >
                        {task.enabled ? 'enabled' : 'disabled'}
                      </span>
                      {task.lastError ? (
                        <p className="mt-1 text-xs text-danger">
                          {task.lastError}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      {canControl ? (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void toggleEnabled(task)}
                          >
                            {task.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void handleRun(task)}
                          >
                            Run now
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void handleDelete(task)}
                          >
                            Delete
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {canControl ? (
        <Card>
          <CardHeader
            title="New schedule"
            description="Examples: daily restart at 06:00 UTC → cron 0 6 * * *. Hourly backup → interval + action backup."
          />
          <form className="space-y-4 p-4" onSubmit={(e) => void handleCreate(e)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="sch-name">Name</Label>
                <Input
                  id="sch-name"
                  value={form.name}
                  required
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="sch-action">Action</Label>
                <Select
                  id="sch-action"
                  value={form.action}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      action: e.target.value as ScheduleAction,
                    }))
                  }
                >
                  <option value="restart">Restart</option>
                  <option value="start">Start</option>
                  <option value="stop">Stop</option>
                  <option value="command">Console command</option>
                  <option value="backup">Backup</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="sch-kind">Schedule type</Label>
                <Select
                  id="sch-kind"
                  value={form.scheduleKind}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      scheduleKind: e.target.value as ScheduleKind,
                    }))
                  }
                >
                  <option value="cron">Cron (UTC)</option>
                  <option value="interval">Interval</option>
                  <option value="once">One-shot</option>
                </Select>
              </div>
              {form.scheduleKind === 'cron' ? (
                <div>
                  <Label htmlFor="sch-cron">Cron expression</Label>
                  <Input
                    id="sch-cron"
                    value={form.cronExpr ?? ''}
                    placeholder="0 6 * * *"
                    onChange={(e) =>
                      setForm((f) => ({ ...f, cronExpr: e.target.value }))
                    }
                  />
                </div>
              ) : null}
              {form.scheduleKind === 'interval' ? (
                <div>
                  <Label htmlFor="sch-interval">Interval (minutes)</Label>
                  <Input
                    id="sch-interval"
                    type="number"
                    min={1}
                    value={form.intervalMinutes ?? 60}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        intervalMinutes: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              ) : null}
              {form.scheduleKind === 'once' ? (
                <div>
                  <Label htmlFor="sch-runat">Run at (ISO / local datetime)</Label>
                  <Input
                    id="sch-runat"
                    type="datetime-local"
                    value={
                      form.runAt
                        ? form.runAt.slice(0, 16)
                        : ''
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({
                        ...f,
                        runAt: v ? new Date(v).toISOString() : '',
                      }));
                    }}
                  />
                </div>
              ) : null}
              {form.action === 'command' ? (
                <div className="sm:col-span-2">
                  <Label htmlFor="sch-cmd">Console command</Label>
                  <Input
                    id="sch-cmd"
                    value={form.command}
                    placeholder="say Hello"
                    required
                    onChange={(e) =>
                      setForm((f) => ({ ...f, command: e.target.value }))
                    }
                  />
                </div>
              ) : null}
              {form.action === 'restart' ? (
                <>
                  <div>
                    <Label htmlFor="sch-cd">
                      Countdown minutes (comma-separated)
                    </Label>
                    <Input
                      id="sch-cd"
                      value={form.countdownText}
                      placeholder="15, 10, 5, 1"
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          countdownText: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="sch-cdmsg">
                      Countdown command ({'{minutes}'} placeholder)
                    </Label>
                    <Input
                      id="sch-cdmsg"
                      value={form.countdownMessage}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          countdownMessage: e.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}
            </div>
            <Checkbox
              label="Enabled"
              checked={form.enabled ?? true}
              onChange={(e) =>
                setForm((f) => ({ ...f, enabled: e.target.checked }))
              }
            />
            <Button type="submit" disabled={busy}>
              Create schedule
            </Button>
          </form>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
