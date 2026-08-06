import type { AuthUser, UserRole } from '@bannerlord-panel/shared';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../auth/passwords.js';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  display_name: string | null;
  disabled: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Keep local so API boot doesn't depend on a freshly rebuilt shared dist. */
function normalizeRole(role: string | null | undefined): UserRole {
  if (role === 'admin' || role === 'moderator' || role === 'user') return role;
  if (role === 'viewer') return 'user';
  return 'user';
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: normalizeRole(row.role),
    displayName: row.display_name,
    disabled: row.disabled,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class UserRegistry {
  constructor(private readonly pool: Pool) {}

  async seedAdmin(input: {
    username: string;
    password: string;
  }): Promise<AuthUser> {
    const existing = await this.findByUsername(input.username);
    if (existing) {
      return existing.user;
    }

    const passwordHash = await hashPassword(input.password);
    const { rows } = await this.pool.query<UserRow>(
      `
      INSERT INTO users (id, username, password_hash, role, display_name)
      VALUES ($1, $2, $3, 'admin', 'Administrator')
      ON CONFLICT (username) DO NOTHING
      RETURNING *
      `,
      [randomUUID(), input.username, passwordHash],
    );

    if (rows[0]) return toAuthUser(rows[0]);
    const again = await this.findByUsername(input.username);
    if (!again) throw new Error('Failed to seed admin user');
    return again.user;
  }

  async list(): Promise<AuthUser[]> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT * FROM users ORDER BY username ASC`,
    );
    return rows.map(toAuthUser);
  }

  async get(id: string): Promise<AuthUser | null> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ? toAuthUser(rows[0]) : null;
  }

  async findByUsername(
    username: string,
  ): Promise<{ user: AuthUser; passwordHash: string } | null> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE username = $1`,
      [username],
    );
    if (!rows[0]) return null;
    return { user: toAuthUser(rows[0]), passwordHash: rows[0].password_hash };
  }

  async create(input: {
    username: string;
    password: string;
    role: UserRole;
    displayName?: string;
  }): Promise<AuthUser> {
    const passwordHash = await hashPassword(input.password);
    const { rows } = await this.pool.query<UserRow>(
      `
      INSERT INTO users (id, username, password_hash, role, display_name)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        randomUUID(),
        input.username,
        passwordHash,
        input.role,
        input.displayName ?? null,
      ],
    );
    return toAuthUser(rows[0]);
  }

  async update(
    id: string,
    patch: {
      role?: UserRole;
      displayName?: string | null;
      disabled?: boolean;
      password?: string;
    },
  ): Promise<AuthUser | null> {
    const passwordHash = patch.password
      ? await hashPassword(patch.password)
      : undefined;

    const { rows } = await this.pool.query<UserRow>(
      `
      UPDATE users SET
        role = COALESCE($2, role),
        display_name = COALESCE($3, display_name),
        disabled = COALESCE($4, disabled),
        password_hash = COALESCE($5, password_hash),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        patch.role ?? null,
        patch.displayName === undefined ? null : patch.displayName,
        patch.disabled ?? null,
        passwordHash ?? null,
      ],
    );
    return rows[0] ? toAuthUser(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM users WHERE id = $1`, [
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }
}
