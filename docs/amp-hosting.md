# Running the panel under AMP (Node.js / Generic)

Your VPS already has **CubeCoders AMP**. AMP can start this panel’s Node processes with the **Generic** module (or AMP’s Node.js app runner template). That is fine for **API + agent**.

This panel is **not** an AMP game template for Bannerlord Coop. Coop instances are still Docker/Wine containers created by **our agent**, not by AMP’s Minecraft-style modules.

---

## What AMP should run vs what it should not

| Piece | Under AMP Node runner? | Notes |
|-------|------------------------|--------|
| **API** (`apps/api`) | Yes | Express + Socket.IO on port 3000 |
| **Agent** (`apps/agent`) | Yes (same process tree) | Needs **Docker socket** + data root |
| **Web UI** | Prefer **Nginx** (static `apps/web/dist`) | Or a second tiny static server |
| **Postgres** | No (Compose / system Postgres) | Keep `pnpm db:up` or external DB |
| **Bannerlord Coop containers** | No | Created by agent via Docker |

**Do not** create Coop servers as AMP “game instances” *and* as panel servers — pick one control plane (this panel) for Coop.

---

## Critical: run on the host, not inside ampbase Docker (unless you know Docker-in-Docker)

AMP Generic instances can run:

1. **On the host** (recommended for this panel), or  
2. **Inside** `cubecoders/ampbase:nodejs` Docker  

The agent must talk to the real Docker daemon (`/var/run/docker.sock`) and write `/var/lib/bannerlord-panel`.  

If AMP runs your Node app **inside** a container **without** mounting:

- `/var/run/docker.sock`
- `/var/lib/bannerlord-panel`

…game create/start will fail.

**Recommended:** create the AMP instance as a **non-Docker** (host) Generic instance, or mount those paths into the AMP Docker instance.

---

## One-time host setup (still required)

Same as [vps-deploy-guide.md](./vps-deploy-guide.md):

```bash
# Panel code
sudo mkdir -p /opt/bannerlord-panel
# clone/rsync repo → /opt/bannerlord-panel

cd /opt/bannerlord-panel
cp .env.example .env
# edit secrets, AGENT_DATA_ROOT, CORS_ORIGIN, tokens

pnpm install
pnpm -r run build          # shared + api + agent + web
pnpm db:up                 # Postgres
pnpm build:runtime         # Wine image for Coop containers

sudo mkdir -p /var/lib/bannerlord-panel/{installations,servers,backups,staging}
```

Serve the UI with Nginx (example):

```nginx
server {
  listen 80;
  server_name panel.example.com;

  root /opt/bannerlord-panel/apps/web/dist;
  index index.html;

  location / {
    try_files $uri /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
  }

  location /health {
    proxy_pass http://127.0.0.1:3000;
  }

  location /client-socket/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

Set `.env` `CORS_ORIGIN` to your panel URL.

---

## AMP Generic instance (Node runner)

### Create instance

1. ADS → **Create Instance** → **Generic** (or Node.js App Runner if listed)  
2. Prefer **not** using Docker for this instance (host process)  
3. Working directory: `/opt/bannerlord-panel`

### Application settings (conceptually)

| Setting | Value |
|---------|--------|
| Application executable | `node` |
| Application arguments | `scripts/amp-runner.mjs` |
| Working directory | `/opt/bannerlord-panel` |
| Startup type | Immediate / after update as you prefer |

`scripts/amp-runner.mjs` starts **API + agent** together and keeps the AMP “server” process alive.

### Ports in AMP

Expose/monitor **3000** (API) if you want AMP port bindings.  
Game ports (**4200+**) are published by **panel Docker containers**, not by this AMP instance — open them on the host firewall separately.

### Environment

Point AMP’s environment (or use `/opt/bannerlord-panel/.env`) at the same vars as `.env.example`:

- `DATABASE_URL`
- `JWT_*`, `ADMIN_*`
- `DEFAULT_AGENT_TOKEN` / `AGENT_TOKEN` (match)
- `AGENT_DATA_ROOT=/var/lib/bannerlord-panel`
- `DOCKER_SOCKET=/var/run/docker.sock`
- `API_URL=http://127.0.0.1:3000`

---

## Example `GenericModule.kvp` snippets

Exact keys vary by AMP version; adjust in the instance config editor / KVP:

```ini
App.DisplayName=Bannerlord Coop Panel
App.RootDir=/opt/bannerlord-panel
App.Executable=node
App.CommandLineArgs=scripts/amp-runner.mjs
```

If you must use Docker for the AMP instance:

```ini
Meta.SpecificDockerImage=cubecoders/ampbase:nodejs
```

…and mount host Docker socket + data root into that instance (AMP Docker volume mounts / custom image). Host-mode Generic is simpler.

---

## Day-to-day

| Action | Where |
|--------|--------|
| Start / stop panel (API+agent) | AMP instance Start/Stop |
| Import DedicatedServer | Panel UI → **Installations** (after scp to staging) |
| Create / start Coop servers | Panel UI → **Create server** / Start |
| Schedules / backups / console | Panel UI |
| Other games (MC, etc.) | Keep using AMP as usual |

---

## Common pitfalls

1. **Agent offline** — AMP instance running but Docker socket not available to the process  
2. **Create server 502** — runtime image missing (`pnpm build:runtime`) or agent can’t reach Docker  
3. **UI loads, API fails** — Nginx not proxying `/api` and `/client-socket`  
4. **Running Coop twice** — don’t also attach the same ports in an AMP Wine/Generic Bannerlord instance  

---

## Summary

Yes: use AMP’s Node/Generic runner to **start and supervise** this panel’s Node.js API + agent via `scripts/amp-runner.mjs`.  

No: AMP does not replace Docker/Wine for Coop; the panel agent still owns those containers. Serve the built web UI with Nginx and keep Postgres + the runtime image on the host as in the VPS guide.
