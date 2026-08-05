import type { HostNode, HostStatus } from '@bannerlord-panel/shared';
import type { Pool } from 'pg';
import { hashAgentToken, type ApiConfig } from '../config.js';

interface HostRow {
  id: string;
  name: string;
  endpoint: string;
  data_root: string;
  status: HostStatus;
  agent_token_hash: string;
  capabilities: unknown;
  last_seen_at: Date | null;
  created_at: Date;
}

function toHostNode(row: HostRow): HostNode {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    dataRoot: row.data_root,
    status: row.status,
    capabilities: Array.isArray(row.capabilities)
      ? (row.capabilities as string[])
      : [],
    createdAt: row.created_at.toISOString(),
  };
}

export class HostRegistry {
  constructor(private readonly pool: Pool) {}

  async seedDefaultHost(config: ApiConfig): Promise<HostNode> {
    const tokenHash = hashAgentToken(config.DEFAULT_AGENT_TOKEN);
    const { rows } = await this.pool.query<HostRow>(
      `
      INSERT INTO hosts (id, name, endpoint, data_root, status, agent_token_hash, capabilities)
      VALUES ($1, $2, '', $3, 'offline', $4, '[]'::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        data_root = EXCLUDED.data_root,
        agent_token_hash = EXCLUDED.agent_token_hash,
        updated_at = NOW()
      RETURNING *
      `,
      [
        config.DEFAULT_HOST_ID,
        config.DEFAULT_HOST_NAME,
        config.DEFAULT_HOST_DATA_ROOT,
        tokenHash,
      ],
    );
    return toHostNode(rows[0]);
  }

  async listHosts(): Promise<HostNode[]> {
    const { rows } = await this.pool.query<HostRow>(
      'SELECT * FROM hosts ORDER BY name ASC',
    );
    return rows.map(toHostNode);
  }

  async getHost(id: string): Promise<HostNode | null> {
    const { rows } = await this.pool.query<HostRow>(
      'SELECT * FROM hosts WHERE id = $1',
      [id],
    );
    return rows[0] ? toHostNode(rows[0]) : null;
  }

  async getHostTokenHash(id: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ agent_token_hash: string }>(
      'SELECT agent_token_hash FROM hosts WHERE id = $1',
      [id],
    );
    return rows[0]?.agent_token_hash ?? null;
  }

  async findHostByTokenHash(tokenHash: string): Promise<HostNode | null> {
    const { rows } = await this.pool.query<HostRow>(
      'SELECT * FROM hosts WHERE agent_token_hash = $1 LIMIT 1',
      [tokenHash],
    );
    return rows[0] ? toHostNode(rows[0]) : null;
  }

  async markOnline(id: string, endpoint: string): Promise<HostNode | null> {
    const { rows } = await this.pool.query<HostRow>(
      `
      UPDATE hosts
      SET status = 'online',
          endpoint = $2,
          last_seen_at = NOW(),
          updated_at = NOW()
      WHERE id = $1 AND status <> 'disabled'
      RETURNING *
      `,
      [id, endpoint],
    );
    return rows[0] ? toHostNode(rows[0]) : null;
  }

  async markOffline(id: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE hosts
      SET status = 'offline',
          updated_at = NOW()
      WHERE id = $1 AND status = 'online'
      `,
      [id],
    );
  }

  async touchHeartbeat(id: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE hosts
      SET last_seen_at = NOW(),
          status = CASE WHEN status = 'disabled' THEN status ELSE 'online' END,
          updated_at = NOW()
      WHERE id = $1
      `,
      [id],
    );
  }
}
