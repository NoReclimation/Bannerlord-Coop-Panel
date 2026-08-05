# Docker Compose

## PostgreSQL (Phase 2)

```bash
# from repo root
pnpm db:up
# or
docker compose -f docker/compose/docker-compose.yml up -d
```

Default connection (see `.env.example`):

`postgres://bannerlord:bannerlord@127.0.0.1:5432/bannerlord_panel`

Then run migrations + default host seed:

```bash
cp .env.example .env   # once
pnpm migrate
```

## Full stack (later)

Compose services for api, agent, nginx, and the Bannerlord runtime image land in Phase 3+.
