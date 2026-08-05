/**
 * Import a drop-in DedicatedServer package into the panel data root.
 *
 *   pnpm import:installation --source ./DedicatedServer
 *   pnpm import:installation --source ./staging/DedicatedServer --data-root /var/lib/bannerlord-panel
 *
 * Copies files into {dataRoot}/installations/<id>/ then prints the register curl.
 * Never overwrites servers/<id>/ or backups/.
 */

import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function resolvePackageRoot(source: string): string {
  const abs = resolve(repoRoot, source);
  if (existsSync(join(abs, 'BannerlordCoopServer.exe'))) return abs;
  const nested = join(abs, 'DedicatedServer');
  if (existsSync(join(nested, 'BannerlordCoopServer.exe'))) return nested;
  return abs;
}

function deriveMeta(packageRoot: string): {
  installationId: string;
  gameVersion: string;
  coopCommit: string;
  layout: string;
} {
  let gameVersion = 'unknown';
  let coopCommit = 'unknown';
  let layout = 'layered-v1';

  const releasePath = join(packageRoot, 'release-info.txt');
  if (existsSync(releasePath)) {
    const text = readFileSync(releasePath, 'utf8');
    const versionMatch = text.match(/Bannerlord v([\d.]+)/i);
    const commitMatch = text.match(/commit\s+([a-f0-9]+)/i);
    if (versionMatch) gameVersion = versionMatch[1]!;
    if (commitMatch) coopCommit = commitMatch[1]!.slice(0, 7);
  }

  const layoutPath = join(packageRoot, 'archive-layout.json');
  if (existsSync(layoutPath)) {
    try {
      const json = JSON.parse(readFileSync(layoutPath, 'utf8')) as {
        layout?: string;
      };
      if (json.layout) layout = json.layout;
    } catch {
      // ignore
    }
  }

  return {
    installationId: `bannerlord-${gameVersion}-coop-${coopCommit}`,
    gameVersion,
    coopCommit,
    layout,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const source = typeof args.source === 'string' ? args.source : '';
  const dataRoot =
    typeof args['data-root'] === 'string'
      ? args['data-root']
      : '/var/lib/bannerlord-panel';

  if (!source) {
    console.error(
      'Usage: pnpm import:installation --source <DedicatedServer path> [--data-root <path>]',
    );
    process.exitCode = 1;
    return;
  }

  const packageRoot = resolvePackageRoot(source);
  const exe = join(packageRoot, 'BannerlordCoopServer.exe');
  if (!existsSync(exe)) {
    console.error(`BannerlordCoopServer.exe not found under ${packageRoot}`);
    process.exitCode = 1;
    return;
  }

  const meta = deriveMeta(packageRoot);
  const target = join(dataRoot, 'installations', meta.installationId);

  mkdirSync(join(dataRoot, 'installations'), { recursive: true });
  mkdirSync(join(dataRoot, 'staging'), { recursive: true });
  console.log(`Copying ${packageRoot} → ${target}`);
  cpSync(packageRoot, target, { recursive: true, force: true });

  console.log('');
  console.log('Import complete.');
  console.log(`  installation id: ${meta.installationId}`);
  console.log(`  path:            ${target}`);
  console.log(`  gameVersion:     ${meta.gameVersion}`);
  console.log(`  coopCommit:      ${meta.coopCommit}`);
  console.log(`  layout:          ${meta.layout}`);
  console.log('');
  console.log('Register in the panel UI (Installations → Import) or via API:');
  console.log(`  path: ${target}`);
}

main();
