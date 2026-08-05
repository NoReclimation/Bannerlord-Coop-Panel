import { Cron } from 'croner';
import type { ScheduleKind } from '@bannerlord-panel/shared';

export function computeNextRunAt(input: {
  scheduleKind: ScheduleKind;
  cronExpr?: string | null;
  intervalMinutes?: number | null;
  runAt?: string | null;
  from?: Date;
}): Date | null {
  const from = input.from ?? new Date();

  if (input.scheduleKind === 'once') {
    if (!input.runAt) return null;
    const at = new Date(input.runAt);
    if (Number.isNaN(at.getTime())) return null;
    return at.getTime() > from.getTime() ? at : null;
  }

  if (input.scheduleKind === 'interval') {
    const mins = input.intervalMinutes;
    if (!mins || mins < 1) return null;
    return new Date(from.getTime() + mins * 60_000);
  }

  const expr = input.cronExpr?.trim();
  if (!expr) return null;
  try {
    const job = new Cron(expr, { timezone: 'UTC' });
    const next = job.nextRun(from);
    return next ?? null;
  } catch {
    return null;
  }
}

export function validateScheduleFields(input: {
  scheduleKind: ScheduleKind;
  cronExpr?: string | null;
  intervalMinutes?: number | null;
  runAt?: string | null;
  action: string;
  payload?: { command?: string };
}): string | null {
  if (input.scheduleKind === 'cron') {
    if (!input.cronExpr?.trim()) return 'cronExpr required for cron schedules';
    try {
      void new Cron(input.cronExpr.trim());
    } catch {
      return 'Invalid cron expression';
    }
  }
  if (input.scheduleKind === 'interval') {
    if (!input.intervalMinutes || input.intervalMinutes < 1) {
      return 'intervalMinutes must be >= 1';
    }
  }
  if (input.scheduleKind === 'once') {
    if (!input.runAt) return 'runAt required for one-shot schedules';
    if (Number.isNaN(new Date(input.runAt).getTime())) {
      return 'Invalid runAt timestamp';
    }
  }
  if (input.action === 'command') {
    const cmd = input.payload?.command?.trim();
    if (!cmd) return 'payload.command required for command action';
  }
  return null;
}
