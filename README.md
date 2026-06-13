# When

Single-user appointment scheduling. A public booking page, an admin UI, calendar
integration (Google + CalDAV), and email notifications — all configured through one
YAML file.

"When" runs as two services that share a single `config.yaml` and data directory:
the **web** app (booking page + admin) and a background **worker** that handles
calendar sync and sends booking emails off the request path. The bundled
`apps/web/docker-compose.yml` runs both.

## Quick start (Docker)

1. Copy `apps/web/config.example.yaml` to `apps/web/config.yaml` and fill it in. Point
   your editor at the bundled schema for autocomplete and validation — the example's
   first line already does this:

   ```yaml
   # yaml-language-server: $schema=./config.schema.json
   ```

   See [`docs/config.md`](docs/config.md) for the full configuration reference.

2. Generate the secrets the app needs and export them in your environment:

   ```sh
   pnpm hash-password            # -> ADMIN_PASSWORD_HASH (skip if using OIDC)
   openssl rand -base64 32       # -> ENCRYPTION_KEY
   openssl rand -base64 32       # -> AUTH_SECRET
   ```

   The full list of environment variables is in
   [`docs/deployment.md`](docs/deployment.md).

3. Bring up both services:

   ```sh
   docker compose -f apps/web/docker-compose.yml up -d
   ```

   The booking page is at `http://localhost:3000/` and the admin UI at `/admin`. The
   container runs database migrations on boot. SQLite lives under `/app/data`; the
   bundled compose file mounts `./data` so bookings survive restarts.

## Documentation

- [Philosophy](docs/philosophy.md) — what "When" is, and the principles behind it.
- [Architecture](docs/architecture.md) — how the system is built.
- [Configuration](docs/config.md) — the full `config.yaml` reference.
- [Deployment](docs/deployment.md) — environment variables, Docker, persistence, and operating endpoints.
- [Development](docs/development.md) — running it locally, the scripts, testing, and coding conventions.
