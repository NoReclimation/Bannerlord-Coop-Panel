import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadApiConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { HostRegistry } from '../services/host-registry.js';
import { UserRegistry } from '../services/user-registry.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function main(): Promise<void> {
  const config = loadApiConfig();
  const pool = createPool(config.DATABASE_URL);
  const migrationsDir = resolve(__dirname, '../../../../database/migrations');
  const applied = await runMigrations(pool, migrationsDir);
  const hosts = new HostRegistry(pool);
  const users = new UserRegistry(pool);
  const defaultHost = await hosts.seedDefaultHost(config);
  const admin = await users.seedAdmin({
    username: config.ADMIN_USERNAME,
    password: config.ADMIN_PASSWORD,
  });
  console.log('Migrations applied:', applied.length ? applied.join(', ') : '(none)');
  console.log('Default host:', defaultHost.id, defaultHost.name);
  console.log('Admin user:', admin.username, admin.role);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
