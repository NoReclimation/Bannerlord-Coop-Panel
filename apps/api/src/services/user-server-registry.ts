import type { GameServerRecord, ServerLifecycleStatus } from '@bannerlord-panel/shared';
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

export class UserServerRegistry {
  constructor(private readonly pool: Pool) {}

  async isAssigned(userId: string, serverId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ ok: number }>(
      `SELECT 1 AS ok FROM user_servers WHERE user_id = $1 AND server_id = $2`,
      [userId, serverId],
    );
    return rows.length > 0;
  }

  async listServerIdsForUser(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ server_id: string }>(
      `SELECT server_id FROM user_servers WHERE user_id = $1 ORDER BY assigned_at ASC`,
      [userId],
    );
    return rows.map((r) => r.server_id);
  }

  async listUserIdsForServer(serverId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM user_servers WHERE server_id = $1 ORDER BY assigned_at ASC`,
      [serverId],
    );
    return rows.map((r) => r.user_id);
  }

  async listServersForUser(
    userId: string,
    hostId?: string,
  ): Promise<GameServerRecord[]> {
    const { rows } = hostId
      ? await this.pool.query<ServerRow>(
          `
          SELECT s.*
          FROM servers s
          INNER JOIN user_servers us ON us.server_id = s.id
          WHERE us.user_id = $1 AND s.host_id = $2
          ORDER BY s.name ASC
          `,
          [userId, hostId],
        )
      : await this.pool.query<ServerRow>(
          `
          SELECT s.*
          FROM servers s
          INNER JOIN user_servers us ON us.server_id = s.id
          WHERE us.user_id = $1
          ORDER BY s.name ASC
          `,
          [userId],
        );
    return rows.map(toRecord);
  }

  async setServersForUser(
    userId: string,
    serverIds: string[],
    assignedBy: string,
  ): Promise<string[]> {
    const unique = [...new Set(serverIds)];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM user_servers WHERE user_id = $1`, [
        userId,
      ]);
      for (const serverId of unique) {
        await client.query(
          `
          INSERT INTO user_servers (user_id, server_id, assigned_by)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, server_id) DO NOTHING
          `,
          [userId, serverId, assignedBy],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.listServerIdsForUser(userId);
  }

  async setUsersForServer(
    serverId: string,
    userIds: string[],
    assignedBy: string,
  ): Promise<string[]> {
    const unique = [...new Set(userIds)];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM user_servers WHERE server_id = $1`, [
        serverId,
      ]);
      for (const userId of unique) {
        await client.query(
          `
          INSERT INTO user_servers (user_id, server_id, assigned_by)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, server_id) DO NOTHING
          `,
          [userId, serverId, assignedBy],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.listUserIdsForServer(serverId);
  }
}
