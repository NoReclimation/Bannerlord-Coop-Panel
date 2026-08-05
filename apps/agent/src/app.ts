import express, { type Express } from 'express';
import type { AgentConfig } from './config.js';
import type { ApiConnection } from './api-connection.js';

export function createAgentApp(
  config: AgentConfig,
  connection: ApiConnection,
): Express {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'agent',
      hostId: config.HOST_ID,
      name: config.AGENT_NAME,
      dataRoot: config.AGENT_DATA_ROOT,
      apiConnected: connection.isConnected(),
      at: new Date().toISOString(),
    });
  });

  return app;
}
