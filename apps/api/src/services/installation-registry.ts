import type { GameInstallation } from '@bannerlord-panel/shared';
import type { Pool } from 'pg';

interface InstallationRow {
  id: string;
  host_id: string;
  game_type: string;
  game_version: string;
  coop_commit: string;
  layout: string;
  path: string;
  created_at: Date;
}

function toInstallation(row: InstallationRow): GameInstallation {
  return {
    id: row.id,
    hostId: row.host_id,
    gameType: row.game_type as GameInstallation['gameType'],
    gameVersion: row.game_version,
    coopCommit: row.coop_commit,
    layout: row.layout,
    path: row.path,
    createdAt: row.created_at.toISOString(),
  };
}

export class InstallationRegistry {
  constructor(private readonly pool: Pool) {}

  async list(hostId?: string): Promise<GameInstallation[]> {
    const { rows } = hostId
      ? await this.pool.query<InstallationRow>(
          `SELECT * FROM installations WHERE host_id = $1 ORDER BY created_at DESC`,
          [hostId],
        )
      : await this.pool.query<InstallationRow>(
          `SELECT * FROM installations ORDER BY created_at DESC`,
        );
    return rows.map(toInstallation);
  }

  async get(id: string): Promise<GameInstallation | null> {
    const { rows } = await this.pool.query<InstallationRow>(
      `SELECT * FROM installations WHERE id = $1`,
      [id],
    );
    return rows[0] ? toInstallation(rows[0]) : null;
  }

  async register(input: {
    id: string;
    hostId: string;
    gameVersion: string;
    coopCommit?: string;
    layout?: string;
    path: string;
  }): Promise<GameInstallation> {
    const { rows } = await this.pool.query<InstallationRow>(
      `
      INSERT INTO installations (id, host_id, game_type, game_version, coop_commit, layout, path)
      VALUES ($1, $2, 'bannerlord-coop', $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET
        path = EXCLUDED.path,
        game_version = EXCLUDED.game_version,
        coop_commit = EXCLUDED.coop_commit,
        layout = EXCLUDED.layout
      RETURNING *
      `,
      [
        input.id,
        input.hostId,
        input.gameVersion,
        input.coopCommit ?? '',
        input.layout ?? 'layered-v1',
        input.path,
      ],
    );
    return toInstallation(rows[0]);
  }
}
