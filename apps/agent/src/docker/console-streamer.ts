import type Dockerode from 'dockerode';
import type { ConsoleLinePayload } from '@bannerlord-panel/shared';
import { containerNameFor } from './client.js';

type LineHandler = (payload: ConsoleLinePayload) => void;

interface FollowState {
  refCount: number;
  logStream: NodeJS.ReadableStream | null;
  stdinStream: NodeJS.ReadWriteStream | null;
}

/**
 * Follows container logs and injects console commands via Docker attach stdin.
 */
export class ConsoleStreamer {
  private readonly follows = new Map<string, FollowState>();
  private readonly partials = new Map<string, string>();

  constructor(
    private readonly docker: Dockerode,
    private readonly onLine: LineHandler,
  ) {}

  async subscribe(serverId: string): Promise<void> {
    const existing = this.follows.get(serverId);
    if (existing) {
      existing.refCount += 1;
      return;
    }

    const state: FollowState = {
      refCount: 1,
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
        tail: 150,
      })) as NodeJS.ReadableStream;

      state.logStream = logStream;
      this.pipeDemux(serverId, logStream);
      logStream.on('end', () => this.cleanupStream(serverId));
      logStream.on('error', () => this.cleanupStream(serverId));
    } catch (err) {
      this.follows.delete(serverId);
      throw err;
    }

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

  async unsubscribe(serverId: string): Promise<void> {
    const state = this.follows.get(serverId);
    if (!state) return;
    state.refCount -= 1;
    if (state.refCount > 0) return;
    this.cleanupStream(serverId);
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

  stopAll(): void {
    for (const serverId of [...this.follows.keys()]) {
      this.cleanupStream(serverId);
    }
  }

  private async ensureStdin(serverId: string): Promise<void> {
    let state = this.follows.get(serverId);
    if (!state) {
      state = { refCount: 0, logStream: null, stdinStream: null };
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

    for (const line of lines) {
      if (line.length === 0) continue;
      this.onLine({
        serverId,
        line,
        stream,
        at: new Date().toISOString(),
      });
    }
  }
}
