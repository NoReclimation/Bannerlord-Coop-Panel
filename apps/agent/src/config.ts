import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv();

const envSchema = z.object({
  AGENT_HOST: z.string().default('0.0.0.0'),
  AGENT_PORT: z.coerce.number().int().positive().default(3001),
  API_URL: z.string().url().default('http://127.0.0.1:3000'),
  HOST_ID: z
    .string()
    .uuid()
    .default('00000000-0000-4000-8000-000000000001'),
  AGENT_TOKEN: z.string().min(8).default('dev-agent-token-change-me'),
  AGENT_DATA_ROOT: z.string().default('/var/lib/bannerlord-panel'),
  AGENT_NAME: z.string().default('local'),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  DOCKER_SOCKET: z.string().default('/var/run/docker.sock'),
  RUNTIME_IMAGE: z.string().default('bannerlord-panel/runtime:latest'),
});

export type AgentConfig = z.infer<typeof envSchema>;

export function loadAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): AgentConfig {
  return envSchema.parse(env);
}
