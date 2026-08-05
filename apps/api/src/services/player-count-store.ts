import type { GameServerRecord, PlayerCountPayload } from '@bannerlord-panel/shared';

/**
 * In-memory player counts from DedicatedServer pulse logs (not persisted).
 */
export class PlayerCountStore {
  private readonly counts = new Map<string, number>();

  set(payload: PlayerCountPayload): void {
    this.counts.set(payload.serverId, payload.playerCount);
  }

  clear(serverId: string): void {
    this.counts.delete(serverId);
  }

  get(serverId: string): number | null {
    return this.counts.has(serverId) ? (this.counts.get(serverId) as number) : null;
  }

  attach(server: GameServerRecord): GameServerRecord {
    const playerCount =
      server.status === 'running' || server.status === 'starting'
        ? this.get(server.id)
        : null;
    return { ...server, playerCount };
  }

  attachAll(servers: GameServerRecord[]): GameServerRecord[] {
    return servers.map((s) => this.attach(s));
  }
}
