# Bannerlord runtime image

Build (on the Linux host):

```bash
docker build -t bannerlord-panel/runtime:latest docker/images/bannerlord-runtime
```

The image contains Ubuntu LTS + Wine + entrypoint only. Mount:

| Host path | Container | Mode |
|-----------|-----------|------|
| `{dataRoot}/installations/<id>` | `/opt/bannerlord` | RO |
| `{dataRoot}/servers/<id>` | `/srv/instance` | RW |
| `{dataRoot}/servers/<id>/wineprefix` | `/wineprefix` | RW |

Env:

- `BANNERLORD_INSTALL` (default `/opt/bannerlord`)
- `BANNERLORD_INSTANCE` (default `/srv/instance`)

Publishes game UDP port (and engine port) as allocated by the panel (4200+).
