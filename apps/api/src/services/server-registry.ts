import type {
  GameServerRecord,
  ServerLifecycleStatus,
} from '@bannerlord-panel/shared';
import type { Pool } from 'pg';

interface ServerRow {
  id: string;
  name: string;
  host_id: string;
  installation_id: string;
  game_type: string;
  status: ServerLifecycleStatus;
  game_port: number;
  engine_port: number;
  container_id: string | null;
  container_name: string | null;
  save_name: string;
  password: string;
  autosave_minutes: number;
  log_file: boolean;
  last_restart_at: Date | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: ServerRow): GameServerRecord {
  return {
    id: row.id,
    name: row.name,
    hostId: row.host_id,
    installationId: row.installation_id,
    gameType: row.game_type,
    status: row.status,
    gamePort: row.game_port,
    enginePort: row.engine_port,
    containerId: row.container_id,
    containerName: row.container_name,
    saveName: row.save_name,
    password: row.password,
    autosaveMinutes: row.autosave_minutes,
    logFile: row.log_file,
    lastRestartAt: row.last_restart_at?.toISOString() ?? null,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class ServerRegistry {
  constructor(private readonly pool: Pool) {}

  async list(hostId?: string): Promise<GameServerRecord[]> {
    const { rows } = hostId
      ? await this.pool.query<ServerRow>(
          `SELECT * FROM servers WHERE host_id = $1 ORDER BY name ASC`,
          [hostId],
        )
      : await this.pool.query<ServerRow>(
          `SELECT * FROM servers ORDER BY name ASC`,
        );
    return rows.map(toRecord);
  }

  async get(id: string): Promise<GameServerRecord | null> {
    const { rows } = await this.pool.query<ServerRow>(
      `SELECT * FROM servers WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async create(input: {
    id: string;
    name: string;
    hostId: string;
    installationId: string;
    gamePort: number;
    enginePort: number;
    saveName: string;
    password: string;
    autosaveMinutes: number;
    logFile: boolean;
  }): Promise<GameServerRecord> {
    const { rows } = await this.pool.query<ServerRow>(
      `
      INSERT INTO servers (
        id, name, host_id, installation_id, status,
        game_port, engine_port, save_name, password,
        autosave_minutes, log_file
      ) VALUES (
        $1, $2, $3, $4, 'created',
        $5, $6, $7, $8,
        $9, $10
      )
      RETURNING *
      `,
      [
        input.id,
        input.name,
        input.hostId,
        input.installationId,
        input.gamePort,
        input.enginePort,
        input.saveName,
        input.password,
        input.autosaveMinutes,
        input.logFile,
      ],
    );
    return toRecord(rows[0]);
  }

  async updateProcess(
    id: string,
    process: {
      saveName: string;
      password: string;
      autosaveMinutes: number;
      logFile: boolean;
    },
  ): Promise<GameServerRecord | null> {
    const { rows } = await this.pool.query<ServerRow>(
      `
      UPDATE servers SET
        save_name = $2,
        password = $3,
        autosave_minutes = $4,
        log_file = $5,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        process.saveName,
        process.password,
        process.autosaveMinutes,
        process.logFile,
      ],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async updateStatus(
    id: string,
    status: ServerLifecycleStatus,
    extra?: {
      containerId?: string | null;
      containerName?: string | null;
      errorMessage?: string | null;
      lastRestartAt?: boolean;
    },
  ): Promise<GameServerRecord | null> {
    const { rows } = await this.pool.query<ServerRow>(
      `
      UPDATE servers SET
        status = $2,
        container_id = COALESCE($3, container_id),
        container_name = COALESCE($4, container_name),
        error_message = $5,
        last_restart_at = CASE WHEN $6 THEN NOW() ELSE last_restart_at END,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        status,
        extra?.containerId ?? null,
        extra?.containerName ?? null,
        extra?.errorMessage ?? null,
        extra?.lastRestartAt ?? false,
      ],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM servers WHERE id = $1`, [
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }
}
