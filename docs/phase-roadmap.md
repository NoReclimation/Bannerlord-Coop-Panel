# Phase roadmap

Work is gated: complete a phase, stop, and wait for confirmation before starting the next.

| Phase | Scope | Stop condition |
|-------|--------|----------------|
| **1** | Architecture docs + monorepo skeleton | Done |
| **2** | Backend foundation + host registry | Done |
| **3** | Docker management + auto ports | Done |
| **4** | Auth JWT + RBAC | Done |
| **5** | Frontend shell + settings UI | Done |
| **6** | Realtime console | Done |
| **7** | File manager | Done |
| **8** | Scheduler | Done |
| **9** | Backup system | Confirm |

## Phase 6 status

Delivered:

- Agent: Docker log follow (demux stdout/stderr) + stdin inject for commands
- API: `/client-socket` browser gateway (JWT), room fan-out, agent subscribe/unsubscribe/inject
- Web: Live console tab — ANSI colors, search, pause, clear, download, command input with history, auto-reconnect

## Phase 7 status

Delivered:

- Shared FS protocol (`fs.list|read|write|mkdir|rename|move|delete|search|extractZip|compress`)
- Agent: path-jailed `ServerFileManager` under `servers/<id>/` (adm-zip for extract/compress)
- API: `/api/servers/:id/files/*` with RBAC (`servers:read` / `servers:write`), download + base64 upload
- Web: **Files** tab — browse, upload (drag-drop), download, rename, delete, move, mkdir, text editor with light highlight, search, zip extract/compress

## Phase 8 status

Delivered:

- Migration `005_scheduled_tasks.sql` + shared schedule types
- API: `ScheduleRegistry` + `ScheduleRunner` (15s tick), cron (UTC) / interval / once
- Actions: `restart` (optional countdown announce via console inject + `restart.countdown`), `start`, `stop`, `command`
- REST: `GET|POST /api/servers/:id/schedules`, `PATCH|DELETE .../:taskId`, `POST .../:taskId/run`
- Web: **Schedules** tab — list, create, enable/disable, run now, delete
- Backup actions deferred to Phase 9

## Phase 9 status

Delivered:

- Migration `006_backups.sql` + retention setting (`backups.retentionCount`, default 10)
- Agent: zip create/restore/delete/read under `{dataRoot}/backups/<serverId>/` (saves + configs; excludes wineprefix/logs)
- API: `GET|POST /api/servers/:id/backups`, restore, delete, download; prune on create
- Schedules: `action: backup` end-to-end
- Web: **Backups** tab — create, list, download, restore (stop-safe), delete
