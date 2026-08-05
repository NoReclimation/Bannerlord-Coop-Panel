import pg from 'pg';

const { Pool } = pg;

export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
  });
}

export type { Pool } from 'pg';
