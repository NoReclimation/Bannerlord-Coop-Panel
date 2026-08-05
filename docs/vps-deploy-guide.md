# VPS deploy guide — what goes where

**Target:** a single Linux VPS (Ubuntu 22.04+ recommended).  
**Not supported:** running game containers on Windows.

This guide covers:

1. Where each kind of file lives  
2. Commands to install the panel  
3. Commands to place the Bannerlord Coop package  
4. Commands to register an installation and create a server  

---

## Map: two trees

| Tree | Location | Purpose |
|------|----------|---------|
| **App code** | e.g. `/opt/bannerlord-panel/` (this git repo) | API, agent, web UI, Dockerfiles |
| **Data root** | `/var/lib/bannerlord-panel/` (`AGENT_DATA_ROOT`) | Game installs, live server data, backups |

Game binaries never live inside `apps/`. Panel code never lives inside `installations/`.

```text
/opt/bannerlord-panel/                 ← git clone (app)
  apps/web, apps/api, apps/agent
  packages/shared
  docker/
  database/
  .env

/var/lib/bannerlord-panel/             ← data root (agent owns this)
  installations/<install-id>/          ← shared RO DedicatedServer package
  servers/<server-uuid>/               ← per-instance RW (saves, configs, wine)
  backups/<server-uuid>/               ← zip backups
```

---

## Step 0 — Prerequisites on the VPS

```bash
# Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
sudo npm install -g pnpm@9

# Docker Engine + Compose plugin
# (follow https://docs.docker.com/engine/install/ubuntu/ )
sudo usermod -aG docker $USER
# log out/in so docker works without sudo

# Useful tools
sudo apt-get install -y git curl jq rsync unzip
```

Open firewall UDP ports for game traffic (first server = **4200**, then 4201, …) and TCP for the web/API if you expose them.

---

## Step 1 — Clone the panel (app code)

```bash
sudo mkdir -p /opt/bannerlord-panel
sudo chown "$USER:$USER" /opt/bannerlord-panel
cd /opt/bannerlord-panel

# From your machine: push the repo to GitHub/GitLab, then:
git clone <YOUR_REPO_URL> .

# Or scp/rsync the project from Windows (exclude node_modules):
#   rsync -av --exclude node_modules --exclude .git \
#     "/path/on/windows/bannerlord coop server ui/" \
#     user@vps:/opt/bannerlord-panel/
```

---

## Step 2 — Create the data root

```bash
sudo mkdir -p /var/lib/bannerlord-panel/{installations,servers,backups,mods,templates}
sudo chown -R "$USER:$USER" /var/lib/bannerlord-panel
```

| Folder | What you put here |
|--------|-------------------|
| `installations/` | Copied DedicatedServer packages (one folder per version) |
| `servers/` | **Created by the panel** when you create a server — do not invent these by hand unless restoring |
| `backups/` | **Created by the panel** when you run a backup |
| `mods/` / `templates/` | Reserved for later |

---

## Step 3 — Environment file

```bash
cd /opt/bannerlord-panel
cp .env.example .env
nano .env   # or vim
```

**Must change in production:**

| Variable | Notes |
|----------|--------|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Long random strings |
| `ADMIN_PASSWORD` | Not `changeme123` |
| `DEFAULT_AGENT_TOKEN` / `AGENT_TOKEN` | Same value in both; long random string |
| `CORS_ORIGIN` | Your real web origin, e.g. `https://panel.example.com` |
| `DEFAULT_HOST_DATA_ROOT` / `AGENT_DATA_ROOT` | Keep `/var/lib/bannerlord-panel` unless you chose another path |
| `DATABASE_URL` | Match Compose Postgres (default below is fine for single-host) |

Leave `HOST_ID` / `DEFAULT_HOST_ID` as the seeded UUID unless you know you need another host.

---

## Step 4 — Install dependencies and build shared types

```bash
cd /opt/bannerlord-panel
pnpm install
pnpm --filter @bannerlord-panel/shared build
```

---

## Step 5 — Start Postgres

```bash
cd /opt/bannerlord-panel
pnpm db:up
# → docker compose -f docker/compose/docker-compose.yml up -d

pnpm migrate
# (API also migrates on boot; running explicitly is fine)
```

---

## Step 6 — Build the Wine runtime image

Game containers need this image (Ubuntu + Wine). **Linux host only.**

```bash
cd /opt/bannerlord-panel
pnpm build:runtime
# → docker build -t bannerlord-panel/runtime:latest ...
```

Verify:

```bash
docker images | grep bannerlord-panel/runtime
```

---

## Step 7 — Place the DedicatedServer package (game files)

### Recommended: staging + web UI

```bash
# On VPS — create staging and upload your package
mkdir -p /var/lib/bannerlord-panel/staging/DedicatedServer

# From your PC (example):
# rsync -av DedicatedServer/ user@vps:/var/lib/bannerlord-panel/staging/DedicatedServer/
```

Then in the **web UI**:

1. Open **Installations**
2. Source path: `/var/lib/bannerlord-panel/staging/DedicatedServer`
3. **Inspect** → confirms `BannerlordCoopServer.exe` and fills version/id
4. **Import & register** → copies into `installations/<id>/` and registers in the DB

### Alternative: CLI copy

```bash
cd /opt/bannerlord-panel
pnpm import:installation --source /var/lib/bannerlord-panel/staging/DedicatedServer --data-root /var/lib/bannerlord-panel
# Then still Import/register in the UI, or use the path shown by the CLI with POST /api/installations
```

**Do not** put `CoopData` into `installations/`. Live saves live under `servers/<uuid>/`.

---

## Step 8 — Start the panel processes

Three processes (three terminals, or systemd later):

```bash
cd /opt/bannerlord-panel

pnpm --filter @bannerlord-panel/shared build   # if you changed shared types

pnpm dev:api      # :3000  — migrates DB, seeds admin + default host
pnpm dev:agent    # :3001  — connects to API with AGENT_TOKEN
pnpm dev:web      # :5173  — UI (proxies /api to the API)
```

Sign in: `http://VPS_IP:5173` (or your domain)  
Default: user `admin` / password from `.env` (`ADMIN_PASSWORD`).

For production you will later: `pnpm build` the web app, put Nginx in front, and run API/agent under systemd. Dev mode is enough to validate the stack.

---

## Step 9 — Register / import (web UI)

With API + agent online:

1. **Installations** → paste staging path → Inspect → Import & register  
2. Or use CLI `pnpm import:installation` then register the printed path in the UI  

Skip the curl examples unless you prefer the API.

## Step 10 — Create and start a server (web UI)

1. **Dashboard** → **Create server**  
2. Pick installation, name, optional password  
3. Leave **Start server after create** checked → **Create & start**  
4. You land on the server page (Console / Files / Schedules / Backups / Settings)  
5. Later: use **Start / Stop / Restart / Kill** on the dashboard card or server page  

UDP port is auto-assigned (**4200**, then 4201, …).

```text
/var/lib/bannerlord-panel/servers/<new-uuid>/
  data/
    server-config.json      ← port auto-set (4200, 4201, …)
    Game Saves/
    logs/
  mod-config.json
  wineprefix/
  tmp/
```

**Container mounts:**

| Host path | Container | Mode |
|-----------|-----------|------|
| `installations/<id>/` | `/opt/bannerlord` | read-write (Coop AutoSync writes under the Coop module) |
| `servers/<uuid>/data/` | `/srv/data` | read-write (`--data-dir`) |
| `servers/<uuid>/wineprefix/` | wine prefix | read-write |

---

## Step 11 — Day-2 operations (where things appear)

| Action | Where it lands / command |
|--------|---------------------------|
| Edit settings | UI → server → **Settings** → writes `servers/<id>/data/server-config.json` + `mod-config.json` |
| Console | UI → **Console** |
| Browse files | UI → **Files** → jailed to `servers/<id>/` |
| Schedule restart/backup | UI → **Schedules** |
| Manual backup | UI → **Backups** → zip in `backups/<server-id>/<backup-id>.zip` |
| Stop / start | UI buttons or `POST /api/servers/:id/start\|stop\|restart\|kill` |
| Delete server | Removes **container** only; `servers/<id>/` and `backups/<id>/` stay on disk |

---

## Quick reference — “what goes where”

| Item | Put it here | How |
|------|-------------|-----|
| This repo | `/opt/bannerlord-panel/` | `git clone` / rsync |
| `.env` | `/opt/bannerlord-panel/.env` | copy from `.env.example` |
| DedicatedServer package | `/var/lib/bannerlord-panel/installations/<id>/` | `rsync` then `POST /api/installations` |
| CoopData sample | Optional staging only — **not** required on VPS for live play | — |
| Live saves / configs | `/var/lib/bannerlord-panel/servers/<uuid>/` | Created by panel |
| Backups | `/var/lib/bannerlord-panel/backups/<uuid>/` | Created by panel |
| Postgres data | Docker volume `bannerlord_pg_data` | `pnpm db:up` |

---

## Checklist

- [ ] Linux VPS with Node 20, pnpm, Docker  
- [ ] Repo at `/opt/bannerlord-panel` + `.env` secrets changed  
- [ ] Data root `/var/lib/bannerlord-panel` owned by the user running the agent  
- [ ] `pnpm db:up` + `pnpm build:runtime`  
- [ ] DedicatedServer uploaded to staging (or imported via CLI)  
- [ ] **Installations** UI: Inspect → Import & register  
- [ ] **Dashboard**: Create server → Start  
- [ ] UDP **4200** (or assigned port) open to players  
- [ ] Clients use the **same Coop build** as the installation (pin mismatch → exit code 4)

---

## Related docs

- [architecture.md](./architecture.md) — mounts, ports, security  
- [replacing-installations.md](./replacing-installations.md) — swapping game versions later  
- [phase-roadmap.md](./phase-roadmap.md) — feature phases  
- [amp-hosting.md](./amp-hosting.md) — run API+agent under AMP’s Node/Generic runner  
