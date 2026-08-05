#!/usr/bin/env node
/**
 * Single entrypoint for hosting API + Agent under AMP Generic / Node runner.
 *
 * AMP ApplicationExecutable: node
 * AMP ApplicationArguments:  scripts/amp-runner.mjs
 * AMP WorkingDirectory:      /opt/bannerlord-panel  (repo root)
 *
 * Prerequisites (on the host, not inside ampbase Docker unless you mount these):
 *   - pnpm install && pnpm -r run build already done
 *   - Postgres up (pnpm db:up or external)
 *   - .env present
 *   - Docker socket available to the agent process
 *   - bannerlord-panel/runtime:latest image built
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = [];

function mustExist(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    console.error(`[amp-runner] missing ${rel} — run pnpm -r run build first`);
    process.exit(1);
  }
}

mustExist('packages/shared/dist/index.js');
mustExist('apps/api/dist/index.js');
mustExist('apps/agent/dist/index.js');

function start(name, script, env = {}) {
  console.log(`[amp-runner] starting ${name}`);
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (buf) => {
    process.stdout.write(`[${name}] ${buf}`);
  });
  child.stderr.on('data', (buf) => {
    process.stderr.write(`[${name}] ${buf}`);
  });
  child.on('exit', (code, signal) => {
    console.error(
      `[amp-runner] ${name} exited code=${code} signal=${signal ?? ''}`,
    );
    shutdown(code ?? 1);
  });
  children.push(child);
}

function shutdown(code = 0) {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('api', join(root, 'apps/api/dist/index.js'));
start('agent', join(root, 'apps/agent/dist/index.js'));

console.log(
  '[amp-runner] API + agent running. Serve apps/web/dist with Nginx or a static host.',
);
