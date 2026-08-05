import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshExpiryFromNow,
} from '../auth/tokens.js';

export class RefreshTokenStore {
  constructor(private readonly pool: Pool) {}

  async issue(input: {
    userId: string;
    ttl: string;
    userAgent?: string;
    ip?: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const token = generateRefreshToken();
    const tokenHash = hashRefreshToken(token);
    const expiresAt = refreshExpiryFromNow(input.ttl);

    await this.pool.query(
      `
      INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent, ip)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        randomUUID(),
        input.userId,
        tokenHash,
        expiresAt,
        input.userAgent ?? null,
        input.ip ?? null,
      ],
    );

    return { token, expiresAt };
  }

  async consume(
    token: string,
  ): Promise<{ userId: string; tokenId: string } | null> {
    const tokenHash = hashRefreshToken(token);
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `
      SELECT id, user_id, expires_at, revoked_at
      FROM refresh_tokens
      WHERE token_hash = $1
      `,
      [tokenHash],
    );

    const row = rows[0];
    if (!row || row.revoked_at || row.expires_at.getTime() < Date.now()) {
      return null;
    }

    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
      [row.id],
    );

    return { userId: row.user_id, tokenId: row.id };
  }

  async revoke(token: string): Promise<void> {
    const tokenHash = hashRefreshToken(token);
    await this.pool.query(
      `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE token_hash = $1 AND revoked_at IS NULL
      `,
      [tokenHash],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL
      `,
      [userId],
    );
  }
}
