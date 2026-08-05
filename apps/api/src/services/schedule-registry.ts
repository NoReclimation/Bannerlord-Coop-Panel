import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  CreateScheduledTaskInput,
  ScheduleAction,
  ScheduleKind,
  SchedulePayload,
  ScheduledTask,
  UpdateScheduledTaskInput,
} from '@bannerlord-panel/shared';
import {
  DEFAULT_COUNTDOWN_MESSAGE,
  DEFAULT_RESTART_COUNTDOWN,
} from '@bannerlord-panel/shared';
import { computeNextRunAt, validateScheduleFields } from './schedule-next.js';

interface TaskRow {
  id: string;
  server_id: string;
  name: string;
  enabled: boolean;
  schedule_kind: ScheduleKind;
  cron_expr: string | null;
  interval_minutes: number | null;
  run_at: Date | null;
  action: ScheduleAction;
  payload: SchedulePayload;
  countdown_minutes: number[];
  countdown_message: string;
  countdown_fired: number[];
  last_run_at: Date | null;
  next_run_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

function toTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    enabled: row.enabled,
    scheduleKind: row.schedule_kind,
    cronExpr: row.cron_expr,
    intervalMinutes: row.interval_minutes,
    runAt: row.run_at?.toISOString() ?? null,
    action: row.action,
    payload: row.payload ?? {},
    countdownMinutes: row.countdown_minutes ?? [],
    countdownMessage: row.countdown_message,
    countdownFired: row.countdown_fired ?? [],
    lastRunAt: row.last_run_at?.toISOString() ?? null,
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    lastError: row.last_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function defaultCountdown(action: ScheduleAction, provided?: number[]): number[] {
  if (provided !== undefined) return provided;
  if (action === 'restart') return [...DEFAULT_RESTART_COUNTDOWN];
  return [];
}

export class ScheduleRegistry {
  constructor(private readonly pool: Pool) {}

  async listByServer(serverId: string): Promise<ScheduledTask[]> {
    const { rows } = await this.pool.query<TaskRow>(
      `SELECT * FROM scheduled_tasks WHERE server_id = $1 ORDER BY name ASC`,
      [serverId],
    );
    return rows.map(toTask);
  }

  async get(id: string): Promise<ScheduledTask | null> {
    const { rows } = await this.pool.query<TaskRow>(
      `SELECT * FROM scheduled_tasks WHERE id = $1`,
      [id],
    );
    return rows[0] ? toTask(rows[0]) : null;
  }

  async listEnabled(): Promise<ScheduledTask[]> {
    const { rows } = await this.pool.query<TaskRow>(
      `SELECT * FROM scheduled_tasks WHERE enabled = TRUE`,
    );
    return rows.map(toTask);
  }

  async create(
    serverId: string,
    input: CreateScheduledTaskInput,
  ): Promise<ScheduledTask> {
    const err = validateScheduleFields({
      scheduleKind: input.scheduleKind,
      cronExpr: input.cronExpr,
      intervalMinutes: input.intervalMinutes,
      runAt: input.runAt,
      action: input.action,
      payload: input.payload,
    });
    if (err) throw new Error(err);

    const enabled = input.enabled ?? true;
    const countdownMinutes = defaultCountdown(
      input.action,
      input.countdownMinutes,
    );
    const countdownMessage =
      input.countdownMessage?.trim() || DEFAULT_COUNTDOWN_MESSAGE;

    const next = enabled
      ? computeNextRunAt({
          scheduleKind: input.scheduleKind,
          cronExpr: input.cronExpr,
          intervalMinutes: input.intervalMinutes,
          runAt: input.runAt,
        })
      : null;

    const id = randomUUID();
    const { rows } = await this.pool.query<TaskRow>(
      `
      INSERT INTO scheduled_tasks (
        id, server_id, name, enabled, schedule_kind,
        cron_expr, interval_minutes, run_at, action, payload,
        countdown_minutes, countdown_message, next_run_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10::jsonb,
        $11, $12, $13
      )
      RETURNING *
      `,
      [
        id,
        serverId,
        input.name.trim(),
        enabled,
        input.scheduleKind,
        input.cronExpr?.trim() || null,
        input.intervalMinutes ?? null,
        input.runAt ? new Date(input.runAt) : null,
        input.action,
        JSON.stringify(input.payload ?? {}),
        countdownMinutes,
        countdownMessage,
        next,
      ],
    );
    return toTask(rows[0]!);
  }

  async update(
    id: string,
    input: UpdateScheduledTaskInput,
  ): Promise<ScheduledTask | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const merged = {
      name: input.name?.trim() ?? existing.name,
      enabled: input.enabled ?? existing.enabled,
      scheduleKind: input.scheduleKind ?? existing.scheduleKind,
      cronExpr:
        input.cronExpr !== undefined ? input.cronExpr : existing.cronExpr,
      intervalMinutes:
        input.intervalMinutes !== undefined
          ? input.intervalMinutes
          : existing.intervalMinutes,
      runAt: input.runAt !== undefined ? input.runAt : existing.runAt,
      action: input.action ?? existing.action,
      payload: input.payload ?? existing.payload,
      countdownMinutes:
        input.countdownMinutes ?? existing.countdownMinutes,
      countdownMessage:
        input.countdownMessage?.trim() || existing.countdownMessage,
    };

    const err = validateScheduleFields({
      scheduleKind: merged.scheduleKind,
      cronExpr: merged.cronExpr,
      intervalMinutes: merged.intervalMinutes,
      runAt: merged.runAt,
      action: merged.action,
      payload: merged.payload,
    });
    if (err) throw new Error(err);

    const scheduleChanged =
      input.scheduleKind !== undefined ||
      input.cronExpr !== undefined ||
      input.intervalMinutes !== undefined ||
      input.runAt !== undefined ||
      input.enabled !== undefined;

    let nextRunAt: Date | null = existing.nextRunAt
      ? new Date(existing.nextRunAt)
      : null;
    let countdownFired = existing.countdownFired;

    if (scheduleChanged) {
      nextRunAt = merged.enabled
        ? computeNextRunAt({
            scheduleKind: merged.scheduleKind,
            cronExpr: merged.cronExpr,
            intervalMinutes: merged.intervalMinutes,
            runAt: merged.runAt,
          })
        : null;
      countdownFired = [];
    } else if (input.enabled === false) {
      nextRunAt = null;
      countdownFired = [];
    }

    const { rows } = await this.pool.query<TaskRow>(
      `
      UPDATE scheduled_tasks SET
        name = $2,
        enabled = $3,
        schedule_kind = $4,
        cron_expr = $5,
        interval_minutes = $6,
        run_at = $7,
        action = $8,
        payload = $9::jsonb,
        countdown_minutes = $10,
        countdown_message = $11,
        countdown_fired = $12,
        next_run_at = $13,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        merged.name,
        merged.enabled,
        merged.scheduleKind,
        merged.cronExpr?.trim() || null,
        merged.intervalMinutes,
        merged.runAt ? new Date(merged.runAt) : null,
        merged.action,
        JSON.stringify(merged.payload),
        merged.countdownMinutes,
        merged.countdownMessage,
        countdownFired,
        nextRunAt,
      ],
    );
    return rows[0] ? toTask(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM scheduled_tasks WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async markCountdownFired(
    id: string,
    minutes: number,
  ): Promise<ScheduledTask | null> {
    const { rows } = await this.pool.query<TaskRow>(
      `
      UPDATE scheduled_tasks SET
        countdown_fired = (
          SELECT ARRAY(
            SELECT DISTINCT x FROM unnest(countdown_fired || ARRAY[$2::int]) AS x ORDER BY x
          )
        ),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id, minutes],
    );
    return rows[0] ? toTask(rows[0]) : null;
  }

  async markExecuted(
    id: string,
    opts: { error?: string | null; nextRunAt: Date | null; enabled?: boolean },
  ): Promise<ScheduledTask | null> {
    const { rows } = await this.pool.query<TaskRow>(
      `
      UPDATE scheduled_tasks SET
        last_run_at = NOW(),
        last_error = $2,
        next_run_at = $3,
        enabled = COALESCE($4, enabled),
        countdown_fired = '{}',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [id, opts.error ?? null, opts.nextRunAt, opts.enabled ?? null],
    );
    return rows[0] ? toTask(rows[0]) : null;
  }
}
