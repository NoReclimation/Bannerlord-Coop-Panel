import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export type DeleteRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ServerDeleteRequest {
  id: string;
  serverId: string | null;
  serverName: string | null;
  requestedBy: string;
  requestedByUsername: string | null;
  status: DeleteRequestStatus;
  reviewedBy: string | null;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

interface Row {
  id: string;
  server_id: string | null;
  server_name: string | null;
  requested_by: string;
  requested_by_username: string | null;
  status: DeleteRequestStatus;
  reviewed_by: string | null;
  note: string | null;
  created_at: Date;
  reviewed_at: Date | null;
}

function mapRow(row: Row): ServerDeleteRequest {
  return {
    id: row.id,
    serverId: row.server_id,
    serverName: row.server_name,
    requestedBy: row.requested_by,
    requestedByUsername: row.requested_by_username,
    status: row.status,
    reviewedBy: row.reviewed_by,
    note: row.note,
    createdAt: row.created_at.toISOString(),
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
  };
}

const SELECT = `
  SELECT r.id, r.server_id, COALESCE(s.name, r.server_name) AS server_name,
         r.requested_by, u.username AS requested_by_username,
         r.status, r.reviewed_by, r.note, r.created_at, r.reviewed_at
  FROM server_delete_requests r
  LEFT JOIN servers s ON s.id = r.server_id
  LEFT JOIN users u ON u.id = r.requested_by
`;

export class DeleteRequestRegistry {
  constructor(private readonly pool: Pool) {}

  async create(serverId: string, requestedBy: string, note?: string) {
    const existing = await this.pool.query<{ id: string }>(
      `SELECT id FROM server_delete_requests
       WHERE server_id = $1 AND status = 'pending'
       LIMIT 1`,
      [serverId],
    );
    if (existing.rows[0]) {
      const full = await this.get(existing.rows[0].id);
      return { created: false as const, request: full! };
    }

    const server = await this.pool.query<{ name: string }>(
      `SELECT name FROM servers WHERE id = $1`,
      [serverId],
    );
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO server_delete_requests (id, server_id, server_name, requested_by, status, note)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [id, serverId, server.rows[0]?.name ?? null, requestedBy, note ?? null],
    );
    const request = await this.get(id);
    return { created: true as const, request: request! };
  }

  async get(id: string): Promise<ServerDeleteRequest | null> {
    const { rows } = await this.pool.query<Row>(
      `${SELECT} WHERE r.id = $1`,
      [id],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async list(status: DeleteRequestStatus = 'pending'): Promise<ServerDeleteRequest[]> {
    const { rows } = await this.pool.query<Row>(
      `${SELECT} WHERE r.status = $1 ORDER BY r.created_at DESC`,
      [status],
    );
    return rows.map(mapRow);
  }

  async listPendingServerIds(): Promise<string[]> {
    const { rows } = await this.pool.query<{ server_id: string }>(
      `SELECT server_id FROM server_delete_requests WHERE status = 'pending'`,
    );
    return rows.map((r) => r.server_id);
  }

  async approve(id: string, reviewedBy: string): Promise<ServerDeleteRequest | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE server_delete_requests
       SET status = 'approved', reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [id, reviewedBy],
    );
    if (!rows[0]) return null;
    return this.get(id);
  }

  async reject(id: string, reviewedBy: string, note?: string): Promise<ServerDeleteRequest | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE server_delete_requests
       SET status = 'rejected',
           reviewed_by = $2,
           reviewed_at = NOW(),
           note = COALESCE($3, note)
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [id, reviewedBy, note ?? null],
    );
    if (!rows[0]) return null;
    return this.get(id);
  }
}
