/** Per-server scheduled tasks (API-owned; agent only executes actions). */

export type ScheduleKind = 'cron' | 'interval' | 'once';

export type ScheduleAction =
  | 'restart'
  | 'start'
  | 'stop'
  | 'command'
  | 'backup';

export interface SchedulePayload {
  /** Console command for action=command, or unused otherwise. */
  command?: string;
}

export interface ScheduledTask {
  id: string;
  serverId: string;
  name: string;
  enabled: boolean;
  scheduleKind: ScheduleKind;
  /** Standard 5-field cron when scheduleKind=cron. */
  cronExpr: string | null;
  /** Minutes between runs when scheduleKind=interval. */
  intervalMinutes: number | null;
  /** Absolute time when scheduleKind=once. */
  runAt: string | null;
  action: ScheduleAction;
  payload: SchedulePayload;
  /**
   * Minutes before execute time to announce (restart only).
   * Example: [15, 10, 5, 1]
   */
  countdownMinutes: number[];
  /** Template with `{minutes}` placeholder; sent as a console command. */
  countdownMessage: string;
  /** Offsets already announced for the current upcoming run. */
  countdownFired: number[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledTaskInput {
  name: string;
  enabled?: boolean;
  scheduleKind: ScheduleKind;
  cronExpr?: string | null;
  intervalMinutes?: number | null;
  runAt?: string | null;
  action: ScheduleAction;
  payload?: SchedulePayload;
  countdownMinutes?: number[];
  countdownMessage?: string;
}

export interface UpdateScheduledTaskInput {
  name?: string;
  enabled?: boolean;
  scheduleKind?: ScheduleKind;
  cronExpr?: string | null;
  intervalMinutes?: number | null;
  runAt?: string | null;
  action?: ScheduleAction;
  payload?: SchedulePayload;
  countdownMinutes?: number[];
  countdownMessage?: string;
}

export const DEFAULT_RESTART_COUNTDOWN = [15, 10, 5, 1] as const;

export const DEFAULT_COUNTDOWN_MESSAGE =
  'say Server restarting in {minutes} minute(s)';
