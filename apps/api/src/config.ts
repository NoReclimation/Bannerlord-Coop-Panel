import { createHash, timingSafeEqual } from 'node:crypto';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv();

const envSchema = z.object({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://bannerlord:bannerlord@127.0.0.1:5432/bannerlord_panel'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DEFAULT_HOST_ID: z
    .string()
    .uuid()
    .default('00000000-0000-4000-8000-000000000001'),
  DEFAULT_HOST_NAME: z.string().default('local'),
  DEFAULT_HOST_DATA_ROOT: z.string().default('/var/lib/bannerlord-panel'),
  DEFAULT_AGENT_TOKEN: z.string().min(8).default('dev-agent-token-change-me'),
  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().min(8).default('changeme123'),
});

export type ApiConfig = z.infer<typeof envSchema>;

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return envSchema.parse(env);
}

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function verifyAgentToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashAgentToken(token), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
