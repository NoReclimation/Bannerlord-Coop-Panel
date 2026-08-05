import type { BackupRef } from '@bannerlord-panel/shared';
import type { Pool } from 'pg';

interface BackupRow {
  id: string;
  server_id: string;
  relative_path: string;
  size_bytes: string | number | null;
  note: string | null;
  created_at: Date;
}

function toRef(row: BackupRow): BackupRef {
  return {
    id: row.id,
    serverId: row.server_id,
    path: row.relative_path,
    relativePath: row.relative_path,
    sizeBytes:
      row.size_bytes === null || row.size_bytes === undefined
        ? undefined
        : Number(row.size_bytes),
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}

export class BackupRegistry {
  constructor(private readonly pool: Pool) {}

  async listByServer(serverId: string): Promise<BackupRef[]> {
    const { rows } = await this.pool.query<BackupRow>(
      `SELECT * FROM backups WHERE server_id = $1 ORDER BY created_at DESC`,
      [serverId],
    );
    return rows.map(toRef);
  }

  async get(id: string): Promise<BackupRef | null> {
    const { rows } = await this.pool.query<BackupRow>(
      `SELECT * FROM backups WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRef(rows[0]) : null;
  }

  async create(input: {
    id: string;
    serverId: string;
    relativePath: string;
    sizeBytes?: number;
    note?: string | null;
    createdAt?: string;
  }): Promise<BackupRef> {
    const { rows } = await this.pool.query<BackupRow>(
      `
      INSERT INTO backups (id, server_id, relative_path, size_bytes, note, created_at)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
      RETURNING *
      `,
      [
        input.id,
        input.serverId,
        input.relativePath,
        input.sizeBytes ?? null,
        input.note ?? null,
        input.createdAt ?? null,
      ],
    );
    return toRef(rows[0]!);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM backups WHERE id = $1`, [
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  /** Oldest-first extras beyond retentionCount. */
  async listOverflow(
    serverId: string,
    retentionCount: number,
  ): Promise<BackupRef[]> {
    if (retentionCount < 1) return [];
    const { rows } = await this.pool.query<BackupRow>(
      `
      SELECT * FROM backups
      WHERE server_id = $1
      ORDER BY created_at DESC
      OFFSET $2
      `,
      [serverId, retentionCount],
    );
    return rows.map(toRef);
  }

  async getRetentionCount(): Promise<number> {
    const { rows } = await this.pool.query<{ value: { retentionCount?: number } }>(
      `SELECT value FROM settings WHERE key = 'backups'`,
    );
    const n = rows[0]?.value?.retentionCount;
    return typeof n === 'number' && n >= 1 ? n : 10;
  }
}
