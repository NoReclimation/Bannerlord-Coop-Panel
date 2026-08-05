# Replacing DedicatedServer and CoopData

The two large folders in the workspace (or under `staging/`) are **drop-in packages**, not application source. Swapping to a newer Bannerlord Coop dedicated-server build must not require code changes.

## What each folder is

| Path | Role |
|------|------|
| `DedicatedServer/` | Immutable game/engine package (`BannerlordCoopServer.exe`, `engine/`, `release-info.txt`, `archive-layout.json`) |
| `CoopData/` | Sample/runtime data shape (`mod-config.json`, `DedicatedServer/server-config.json`, saves, logs) |
| `staging/` | Optional alternate drop zone (same layouts); preferred if you want to keep a previous extract nearby |

Live containers mount **versioned** paths under the host data root (default `/var/lib/bannerlord-panel/installations/<id>/`), never the workspace folders.

## Replace workflow

```bash
# 1. Remove or move the old drop-ins
rm -rf DedicatedServer CoopData
# or: rm -rf staging/DedicatedServer staging/CoopData

# 2. Unpack / copy the new official package
#    Expect layered-v1 layout with BannerlordCoopServer.exe and engine/

# 3. Import into the panel data root (creates a new installation id)
pnpm import:installation --source ./DedicatedServer
# or: pnpm import:installation --source ./staging/DedicatedServer

# Optional: seed template defaults from CoopData (does not touch live server data)
# pnpm import:installation --source ./DedicatedServer --coop-data ./CoopData
```

Installation id is derived from `release-info.txt` (game version + Coop commit) and `archive-layout.json`, not from the folder name on disk.

## What is never overwritten

- Per-server directories under `…/servers/<server-id>/` (saves, configs, wine prefix, logs)
- Backups under `…/backups/`

Re-importing or replacing `DedicatedServer/` only adds (or refreshes) an **installation** record. Point each server at the new `installationId` when you are ready to switch; keep the old installation for rollback until you delete it explicitly.

## Checklist

1. Stop servers that will switch versions (or schedule a maintenance window).
2. Drop in the new package; run `pnpm import:installation`.
3. In the panel (Installations UI later; DB/API sooner), assign the new `installationId`.
4. Start servers; verify Coop pin / exit code 4 does not occur (clients must match Coop build).
5. Delete unused old installations only when no server references them.
