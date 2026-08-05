import type { Pool } from 'pg';
import {
  DEFAULT_PORT_SETTINGS,
  type PortSettings,
} from '@bannerlord-panel/shared';

export class PortAllocator {
  constructor(private readonly pool: Pool) {}

  async getPortSettings(): Promise<PortSettings> {
    const { rows } = await this.pool.query<{ value: PortSettings }>(
      `SELECT value FROM settings WHERE key = 'ports'`,
    );
    return rows[0]?.value ?? DEFAULT_PORT_SETTINGS;
  }

  /**
   * Lowest free game + engine ports on a host (prefer filling gaps).
   */
  async allocate(hostId: string): Promise<{ gamePort: number; enginePort: number }> {
    const settings = await this.getPortSettings();
    const { rows } = await this.pool.query<{
      game_port: number;
      engine_port: number;
    }>(`SELECT game_port, engine_port FROM servers WHERE host_id = $1`, [
      hostId,
    ]);

    const usedGame = new Set(rows.map((r) => r.game_port));
    const usedEngine = new Set(rows.map((r) => r.engine_port));

    let gamePort = settings.gamePortBase;
    while (usedGame.has(gamePort)) gamePort += 1;

    let enginePort = settings.enginePortBase;
    while (usedEngine.has(enginePort)) enginePort += 1;

    return { gamePort, enginePort };
  }
}
