import type Dockerode from 'dockerode';
import {
  parseDsEvent,
  parsePlayerDisconnect,
  parsePulsePlayerCount,
  type ConsoleLinePayload,
  type PlayerCountPayload,
  type PlayerLeftPayload,
  type PlayerRosterPayload,
} from '@bannerlord-panel/shared';
import { containerNameFor } from './client.js';

type LineHandler = (payload: ConsoleLinePayload) => void;
type PlayerCountHandler = (payload: PlayerCountPayload) => void;
type RosterHandler = (payload: PlayerRosterPayload) => void;
type PlayerLeftHandler = (payload: PlayerLeftPayload) => void;

interface FollowState {
  /** Browser console subscribers — full lines are forwarded when > 0. */
  consoleRefs: number;
  /** Background pulse watch for player counts (independent of console). */
  pulseWatch: boolean;
  logStream: NodeJS.ReadableStream | null;
  stdinStream: NodeJS.ReadWriteStream | null;
}

/**
 * Follows container logs and injects console commands via Docker attach stdin.
 * Extracts pulse player counts and `@DS@` / disconnect events while watching.
 */
export class ConsoleStreamer {
  private readonly follows = new Map<string, FollowState>();
  private readonly partials = new Map<string, string>();
  private readonly lastPlayerCount = new Map<string, number>();
  private readonly recentLines = new Map<string, ConsoleLinePayload[]>();
  private static readonly RECENT_LIMIT = 150;

  constructor(
    private readonly docker: Dockerode,
    private readonly onLine: LineHandler,
    private readonly onPlayerCount: PlayerCountHandler,
    private readonly onRoster: RosterHandler,
    private readonly onPlayerLeft: PlayerLeftHandler,
  ) {}

  /** Start (or keep) a lightweight log follow used for player counts. */
  async watchPulse(serverId: string): Promise<void> {
    const state = await this.ensureFollow(serverId);
    state.pulseWatch = true;
  }

  async unwatchPulse(serverId: string): Promise<void> {
    const state = this.follows.get(serverId);
    if (!state) return;
    state.pulseWatch = false;
    if (this.lastPlayerCount.has(serverId) || state.consoleRefs === 0) {
      this.lastPlayerCount.delete(serverId);
      this.onPlayerCount({
        serverId,
        playerCount: 0,
        at: new Date().toISOString(),
      });
    }
    this.maybeCleanup(serverId);
  }

  async subscribe(serverId: string): Promise<void> {
    const prevRefs = this.follows.get(serverId)?.consoleRefs ?? 0;
    const state = await this.ensureFollow(serverId);
    state.consoleRefs += 1;
    // If pulse watch already owned the stream, replay buffered lines once.
    if (prevRefs === 0) {
      const buffered = this.recentLines.get(serverId) ?? [];
      for (const line of buffered) {
        this.onLine(line);
      }
    }
  }

  async unsubscribe(serverId: string): Promise<void> {
    const state = this.follows.get(serverId);
    if (!state) return;
    state.consoleRefs = Math.max(0, state.consoleRefs - 1);
    this.maybeCleanup(serverId);
  }

  async inject(serverId: string, command: string): Promise<void> {
    let state = this.follows.get(serverId);
    if (!state?.stdinStream) {
      await this.ensureStdin(serverId);
      state = this.follows.get(serverId);
    }
    const stdin = state?.stdinStream;
    if (!stdin) {
      throw new Error('Console stdin is not available (is the server running?)');
    }
    const line = command.endsWith('\n') ? command : `${command}\n`;
    await new Promise<void>((resolve, reject) => {
      stdin.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Discover running panel containers and start pulse watches. */
  async watchRunningContainers(): Promise<void> {
    const containers = await this.docker.listContainers({
      filters: {
        label: ['bannerlord.panel=1'],
        status: ['running'],
      },
    });
    for (const info of containers) {
      const serverId = info.Labels?.['bannerlord.server_id'];
      if (!serverId) continue;
      try {
        await this.watchPulse(serverId);
        console.log(`[agent] pulse watch ${serverId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[agent] pulse watch failed for ${serverId}: ${message}`);
      }
    }
  }

  stopAll(): void {
    for (const serverId of [...this.follows.keys()]) {
      this.cleanupStream(serverId);
    }
    this.lastPlayerCount.clear();
  }

  private maybeCleanup(serverId: string): void {
    const state = this.follows.get(serverId);
    if (!state) return;
    if (state.consoleRefs > 0 || state.pulseWatch) return;
    this.cleanupStream(serverId);
  }

  private async ensureFollow(serverId: string): Promise<FollowState> {
    const existing = this.follows.get(serverId);
    if (existing?.logStream) return existing;

    const state: FollowState = existing ?? {
      consoleRefs: 0,
      pulseWatch: false,
      logStream: null,
      stdinStream: null,
    };
    this.follows.set(serverId, state);

    const container = this.docker.getContainer(containerNameFor(serverId));

    try {
      const logStream = (await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        timestamps: false,
        // Pulse watch only needs recent lines; console still gets a useful tail.
        tail: 150,
      })) as NodeJS.ReadableStream;

      state.logStream = logStream;
      this.pipeDemux(serverId, logStream);
      logStream.on('end', () => this.cleanupStream(serverId));
      logStream.on('error', () => this.cleanupStream(serverId));
    } catch (err) {
      if (!state.consoleRefs && !state.pulseWatch) {
        this.follows.delete(serverId);
      }
      throw err;
    }

    if (!state.stdinStream) {
      try {
        const attach = (await container.attach({
          stream: true,
          stdin: true,
          stdout: false,
          stderr: false,
          hijack: true,
        })) as NodeJS.ReadWriteStream;
        state.stdinStream = attach;
      } catch {
        // Container may not be running; commands will fail until start + resubscribe
      }
    }

    return state;
  }

  private async ensureStdin(serverId: string): Promise<void> {
    let state = this.follows.get(serverId);
    if (!state) {
      state = {
        consoleRefs: 0,
        pulseWatch: false,
        logStream: null,
        stdinStream: null,
      };
      this.follows.set(serverId, state);
    }
    if (state.stdinStream) return;

    const container = this.docker.getContainer(containerNameFor(serverId));
    const attach = (await container.attach({
      stream: true,
      stdin: true,
      stdout: false,
      stderr: false,
      hijack: true,
    })) as NodeJS.ReadWriteStream;
    state.stdinStream = attach;
  }

  private cleanupStream(serverId: string): void {
    const state = this.follows.get(serverId);
    if (!state) return;
    try {
      (state.logStream as { destroy?: () => void } | null)?.destroy?.();
    } catch {
      // ignore
    }
    try {
      state.stdinStream?.end();
    } catch {
      // ignore
    }
    this.follows.delete(serverId);
    this.partials.delete(`${serverId}:stdout`);
    this.partials.delete(`${serverId}:stderr`);
    this.lastPlayerCount.delete(serverId);
    this.recentLines.delete(serverId);
  }

  private pipeDemux(serverId: string, stream: NodeJS.ReadableStream): void {
    let buffer = Buffer.alloc(0);

    stream.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 8) {
        const streamType = buffer[0];
        const size = buffer.readUInt32BE(4);
        if (buffer.length < 8 + size) break;
        const payload = buffer.subarray(8, 8 + size);
        buffer = buffer.subarray(8 + size);
        const which: 'stdout' | 'stderr' = streamType === 2 ? 'stderr' : 'stdout';
        this.emitLines(serverId, which, payload.toString('utf8'));
      }
    });
  }

  private emitLines(
    serverId: string,
    stream: 'stdout' | 'stderr',
    text: string,
  ): void {
    const key = `${serverId}:${stream}`;
    const prev = this.partials.get(key) ?? '';
    const combined = prev + text;
    const lines = combined.split(/\r?\n/);
    const incomplete = lines.pop() ?? '';
    this.partials.set(key, incomplete);

    const state = this.follows.get(serverId);
    const fanoutConsole = (state?.consoleRefs ?? 0) > 0;

    for (const line of lines) {
      if (line.length === 0) continue;

      const entry: ConsoleLinePayload = {
        serverId,
        line,
        stream,
        at: new Date().toISOString(),
      };

      const recent = this.recentLines.get(serverId) ?? [];
      recent.push(entry);
      if (recent.length > ConsoleStreamer.RECENT_LIMIT) {
        recent.splice(0, recent.length - ConsoleStreamer.RECENT_LIMIT);
      }
      this.recentLines.set(serverId, recent);

      const players = parsePulsePlayerCount(line);
      if (players !== null) {
        const prevCount = this.lastPlayerCount.get(serverId);
        if (prevCount !== players) {
          this.lastPlayerCount.set(serverId, players);
          this.onPlayerCount({
            serverId,
            playerCount: players,
            at: entry.at,
          });
        }
      }

      const ds = parseDsEvent(line);
      if (ds?.ev === 'players') {
        this.onRoster({
          serverId,
          players: ds.list,
          at: entry.at,
        });
        const count = ds.list.length;
        const prevCount = this.lastPlayerCount.get(serverId);
        if (prevCount !== count) {
          this.lastPlayerCount.set(serverId, count);
          this.onPlayerCount({
            serverId,
            playerCount: count,
            at: entry.at,
          });
        }
      }

      const left = parsePlayerDisconnect(line);
      if (left) {
        this.onPlayerLeft({
          serverId,
          peerId: left.peerId,
          partyName: left.partyName,
          at: entry.at,
        });
      }

      if (fanoutConsole) {
        this.onLine(entry);
      }
    }
  }
}
