# Bannerlord Coop Server Panel

Linux-native orchestration panel for Bannerlord Coop dedicated servers (AMP / Pterodactyl–inspired). **Linux only** — not supported on Windows as a deployment host.

See [docs/phase-roadmap.md](docs/phase-roadmap.md), [docs/architecture.md](docs/architecture.md), the step-by-step [docs/vps-deploy-guide.md](docs/vps-deploy-guide.md), and [docs/amp-hosting.md](docs/amp-hosting.md) if the VPS already runs CubeCoders AMP.

## Layout

```text
apps/web          React + Vite + Tailwind + shadcn (Phase 5)
apps/api          Express control plane (Phase 2+)
apps/agent        Host agent: Docker, Wine, console (Phase 2+)
packages/shared   Shared TypeScript contracts
docker/           Runtime image + Compose
database/         Migrations
scripts/          Installation import CLI
staging/          Optional drop zone for new game packages
docs/             Architecture and guides
```

## Hosts / nodes

Default: **one** Management Agent on one machine manages **all** Coop containers (ports 4200, 4201, …).

To add capacity, register another host in the panel and run another agent there. Each server is assigned a `hostId`; the API routes to that agent only.

## Game packages (DedicatedServer / CoopData)

These folders are **replaceable drop-ins**, not app source. They are gitignored.

1. Copy/import the package into `{dataRoot}/installations/<id>/`.
2. Register it: `POST /api/installations`.
3. Create servers against that `installationId`. Saves live under `{dataRoot}/servers/<id>/` and are never deleted with the container.

Details: [docs/replacing-installations.md](docs/replacing-installations.md).

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 9+
- Docker Engine (Postgres + game runtime containers)

## Setup (Phase 3–4)

```bash
pnpm install
cp .env.example .env
pnpm --filter @bannerlord-panel/shared build

pnpm db:up
pnpm migrate

# Build Wine runtime image (Linux host)
pnpm build:runtime

pnpm dev:api
pnpm dev:agent
pnpm dev:web
```

Open `http://127.0.0.1:5173` and sign in with the seeded admin.

### Auth

Default admin (change in `.env`): `admin` / `changeme123`

```bash
curl -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"changeme123"}'
```

Use `Authorization: Bearer <accessToken>` on API calls. Refresh via `POST /api/auth/refresh` with `{ "refreshToken": "..." }`.

| Role | Can |
|------|-----|
| **admin** | Everything (users, installations, create/delete servers, control, settings) |
| **moderator** | Read + start/stop/restart/kill + console (Phase 6) |
| **viewer** | Read-only |

Place a shared install via the **Installations** page (or API), then **Create server** on the Dashboard (optionally start immediately). Ports auto-assign **4200**, then **4201**, … (`steam` is always forced `false`).

Lifecycle: `POST /api/servers/:id/start|stop|restart|kill`, `DELETE /api/servers/:id` (removes container, keeps data/backups).

### Console

Open a server → **Console** tab. Output streams live over Socket.IO (`Wine/Docker → agent → API → browser`). Commands require `console:write` (any role with access to that server).

### Files

Open a server → **Files** tab. Browse the per-server data directory (`servers/<id>/` on the agent host). Upload, download, edit text, zip extract/compress. Paths are jailed to that server root. Mutations require `servers:write`.

### Schedules

Open a server → **Schedules** tab. Create cron (UTC), interval, or one-shot tasks for restart/start/stop/console command/backup. Restart schedules can announce countdown warnings (default 15/10/5/1 minutes) via console inject before the action. Manage with `servers:control`.

### Backups

Open a server → **Backups** tab. Creates zip archives of `Game Saves`, `server-config.json`, `mod-config.json`, `modules.json` / `modules.arg`, and optional `server-mods` under `{dataRoot}/backups/<serverId>/`. Restore stops the container if needed, replaces those paths, then restarts if it was running. Retention keeps the last N backups (default 10).

### Modules

Open a server → **Modules** tab. Scans the shared installation’s `engine/Modules` plus `{dataRoot}/mods/` (one install of each third-party module for all servers). Enable/reorder modules, save per-instance load order, or apply named modpack presets. Selected global mods are RO-mounted into the container; the runtime passes Bannerlord’s `_MODULES_*…*_MODULES_` argument.

## License / game files

Bannerlord and Coop dedicated-server binaries remain subject to their own licenses. This repository does not redistribute them via git. Please support the creators of Bannerlord Coop at the following links as Bannerlord Coop is developed by a volunteer team.

**[Patreon](https://www.patreon.com/c/bannerlordcoop)** — Become a monthly supporter

- **[Buy Me a Coffee](https://buymeacoffee.com/bannerlordcoop)** — Send a one-time contribution
- **[PayPal](https://www.paypal.com/donate/?hosted_button_id=KHBSK4FXQ9GKS)** — Donate directly
- **[Afdian](https://ifdian.net/a/BannerlordCoop)** — Support us from China
- **[Boosty](https://boosty.to/bannerlordcoop/donate)** — Additional international support option
