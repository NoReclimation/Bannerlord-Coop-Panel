import type { ScheduledTask } from '@bannerlord-panel/shared';
import type { AgentGateway } from '../agent/gateway.js';
import type { BrowserGateway } from '../agent/browser-gateway.js';
import type { ServerRegistry } from './server-registry.js';
import type { ScheduleRegistry } from './schedule-registry.js';
import type { BackupRegistry } from './backup-registry.js';
import { computeNextRunAt } from './schedule-next.js';
import { createServerBackup } from '../routes/backups.js';

const TICK_MS = 15_000;

/**
 * Polls due scheduled tasks and runs lifecycle / console actions via the agent.
 */
export class ScheduleRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly schedules: ScheduleRegistry,
    private readonly servers: ServerRegistry,
    private readonly gateway: AgentGateway,
    private readonly browser: BrowserGateway,
    private readonly backups: BackupRegistry,
  ) {}

  start(): void {
    if (this.timer) return;
    console.log('[scheduler] started (tick every 15s)');
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runNow(taskId: string): Promise<ScheduledTask> {
    const task = await this.schedules.get(taskId);
    if (!task) throw new Error('Schedule not found');
    await this.executeAction(task);
    const next =
      task.scheduleKind === 'once'
        ? null
        : computeNextRunAt({
            scheduleKind: task.scheduleKind,
            cronExpr: task.cronExpr,
            intervalMinutes: task.intervalMinutes,
            runAt: task.runAt,
            from: new Date(),
          });
    const updated = await this.schedules.markExecuted(task.id, {
      nextRunAt: next,
      enabled: task.scheduleKind === 'once' ? false : task.enabled,
      error: null,
    });
    if (!updated) throw new Error('Failed to update schedule');
    return updated;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tasks = await this.schedules.listEnabled();
      const now = Date.now();
      for (const task of tasks) {
        if (!task.nextRunAt) continue;
        try {
          await this.processTask(task, now);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[scheduler] task ${task.id} error:`, message);
          await this.schedules.markExecuted(task.id, {
            error: message,
            nextRunAt: this.nextAfterFailure(task),
            enabled: task.scheduleKind === 'once' ? false : true,
          });
        }
      }
    } finally {
      this.running = false;
    }
  }

  private nextAfterFailure(task: ScheduledTask): Date | null {
    if (task.scheduleKind === 'once') return null;
    return computeNextRunAt({
      scheduleKind: task.scheduleKind,
      cronExpr: task.cronExpr,
      intervalMinutes: task.intervalMinutes,
      runAt: task.runAt,
      from: new Date(),
    });
  }

  private async processTask(task: ScheduledTask, nowMs: number): Promise<void> {
    const executeAt = new Date(task.nextRunAt!).getTime();

    if (
      task.action === 'restart' &&
      task.countdownMinutes.length > 0 &&
      nowMs < executeAt
    ) {
      const pending = [...task.countdownMinutes]
        .filter((m) => m > 0)
        .sort((a, b) => b - a);

      for (const minutes of pending) {
        if (task.countdownFired.includes(minutes)) continue;
        const target = executeAt - minutes * 60_000;
        // Only fire inside a short window so late ticks don't announce wrong times
        if (nowMs >= target && nowMs < target + TICK_MS * 3) {
          await this.announceCountdown(task, minutes);
          await this.schedules.markCountdownFired(task.id, minutes);
          task = {
            ...task,
            countdownFired: [...task.countdownFired, minutes],
          };
        }
      }
      return;
    }

    if (nowMs < executeAt) return;

    await this.executeAction(task);

    const next =
      task.scheduleKind === 'once'
        ? null
        : computeNextRunAt({
            scheduleKind: task.scheduleKind,
            cronExpr: task.cronExpr,
            intervalMinutes: task.intervalMinutes,
            runAt: task.runAt,
            from: new Date(Math.max(nowMs, executeAt)),
          });

    await this.schedules.markExecuted(task.id, {
      nextRunAt: next,
      enabled: task.scheduleKind === 'once' ? false : true,
      error: null,
    });
  }

  private async announceCountdown(
    task: ScheduledTask,
    minutes: number,
  ): Promise<void> {
    const server = await this.servers.get(task.serverId);
    if (!server) throw new Error('Server not found');
    if (!this.gateway.isHostConnected(server.hostId)) {
      throw new Error('Host agent is offline');
    }

    const message = task.countdownMessage.replace(
      /\{minutes\}/g,
      String(minutes),
    );

    this.browser.emitRestartCountdown({
      serverId: task.serverId,
      taskId: task.id,
      minutes,
      executeAt: task.nextRunAt!,
      message,
    });

    this.browser.emitConsoleLine({
      serverId: task.serverId,
      line: `[scheduler] ${message}`,
      stream: 'stdout',
      at: new Date().toISOString(),
    });

    const result = await this.gateway.injectConsole(
      server.hostId,
      server.id,
      message,
    );
    if (!result.ok) {
      throw new Error(result.error ?? 'Countdown inject failed');
    }
  }

  private async executeAction(task: ScheduledTask): Promise<void> {
    const server = await this.servers.get(task.serverId);
    if (!server) throw new Error('Server not found');
    if (!this.gateway.isHostConnected(server.hostId)) {
      throw new Error('Host agent is offline');
    }

    if (task.action === 'command') {
      const command = task.payload.command?.trim();
      if (!command) throw new Error('Missing command');
      this.browser.emitConsoleLine({
        serverId: task.serverId,
        line: `[scheduler] > ${command}`,
        stream: 'stdout',
        at: new Date().toISOString(),
      });
      const result = await this.gateway.injectConsole(
        server.hostId,
        server.id,
        command,
      );
      if (!result.ok) throw new Error(result.error ?? 'Command inject failed');
      return;
    }

    if (task.action === 'backup') {
      this.browser.emitConsoleLine({
        serverId: task.serverId,
        line: '[scheduler] backup',
        stream: 'stdout',
        at: new Date().toISOString(),
      });
      await createServerBackup({
        servers: this.servers,
        backups: this.backups,
        gateway: this.gateway,
        serverId: server.id,
        note: 'scheduled',
      });
      return;
    }

    const action =
      task.action === 'restart'
        ? 'server.restart'
        : task.action === 'start'
          ? 'server.start'
          : 'server.stop';

    const pendingStatus =
      action === 'server.start' || action === 'server.restart'
        ? 'starting'
        : 'stopping';
    await this.servers.updateStatus(server.id, pendingStatus);

    this.browser.emitConsoleLine({
      serverId: task.serverId,
      line: `[scheduler] ${task.action}`,
      stream: 'stdout',
      at: new Date().toISOString(),
    });

    const response = await this.gateway.request(server.hostId, action, {
      serverId: server.id,
      ...(action === 'server.start' || action === 'server.restart'
        ? {
            gamePort: server.gamePort,
            enginePort: server.enginePort,
          }
        : {}),
    });

    if (!response.ok) {
      await this.servers.updateStatus(server.id, 'error', {
        errorMessage: response.error ?? 'scheduled action failed',
      });
      throw new Error(response.error ?? 'Agent command failed');
    }

    const nextStatus =
      action === 'server.start' || action === 'server.restart'
        ? 'running'
        : 'stopped';
    await this.servers.updateStatus(server.id, nextStatus, {
      lastRestartAt: action === 'server.start' || action === 'server.restart',
      errorMessage: null,
    });
  }
}
