# Deployment

Running "When" in production. The bundled `apps/web/docker-compose.yml` runs both
services (web + worker) against one `when.yaml` and data directory. See
[`README.md`](../README.md) for the quick start and [`config.md`](config.md) for the
config reference.

## Environment variables

A few variables are read **directly** by the app from the environment:

| Variable         | Required   | Notes                                                                                                                                                  |
| ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`    | always     | Auth.js JWT signing secret. 32+ random bytes, base64-encoded (`openssl rand -base64 32`).                                                              |
| `ENCRYPTION_KEY` | production | Base64 of 32 random bytes. Encrypts OAuth refresh tokens at the column level (AES-256-GCM). In dev an ephemeral key is generated and a warning logged. |

Everything else is a **secret referenced from `when.yaml`** via `${ENV_VAR}`
interpolation — the variable _names_ are whatever your config uses (`config/when.example.yml`
uses simple names like `${SMTP_PASSWORD}`). The table below lists the names the CLI
wizards generate; `<NAME>` is the service's name upper-cased.

| Variable                                                                                | Needed when            | Notes                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `WHEN_ADMIN_PASSWORD`                                                                   | credentials auth       | Plain text password of the admin (defaults to this if omitted in config). |
| `WHEN_OIDC_CLIENT_SECRET`                                                               | OIDC auth              | OIDC provider client secret (written by `config init`).                   |
| `WHEN_SERVICE_CALDAV_<NAME>_PASSWORD` / `WHEN_SERVICE_NEXTCLOUD_<NAME>_PASSWORD`        | a CalDAV/Nextcloud cal | Written by `calendars add caldav` / `calendars add nextcloud`.            |
| `WHEN_SMTP_PASS`                                                                        | always                 | SMTP password — SMTP is required.                                         |
| `WHEN_SERVICE_GOOGLE_<NAME>_CLIENT_SECRET` / `WHEN_SERVICE_GOOGLE_<NAME>_REFRESH_TOKEN` | a Google service       | Written by `calendars add google`.                                        |

The worker also honors a few operational variables:

| Variable                                    | Notes                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_PATH`                               | Path to `when.yaml` (default `/app/config/when.yaml` in prod, `<cwd>/config/when.yaml` otherwise).                   |
| `WHEN_DATABASE_PATH` / `WHEN_QUEUE_DB_PATH` | Optional overrides for the config's `database.app` / `database.queue`.                                               |
| `WHEN_PUBLIC_DIR`                           | Override the branding-overrides dir (default `<root>/public`, i.e. `/app/public` in the container).                  |
| `PORT`                                      | Worker health-server port (default `9000`).                                                                          |
| `WHEN_URL_INTERNAL`                         | Default for `url.internal` (how the worker reaches the web app internally). Baked into the Docker images per target. |

## Docker

```sh
docker compose -f apps/web/docker-compose.yml up -d
```

This brings up the web app (appointment page at \`/\`, admin at \`/admin\`) and the worker
(calendar sync + email delivery). Both run database migrations relevant to their role on
boot.

## Persistence

State is two SQLite files under the data directory the compose file mounts
(`./data` → `/app/data`):

- `when.sqlite` — appointments and OAuth tokens (shared by web + worker).
- `openworkflow.sqlite` — the background job queue (owned by the worker).

Branding overrides live in a separate `public/` directory mounted alongside
(`./public` → `/app/public`, overridable with `WHEN_PUBLIC_DIR`); the web app serves
them at `/public/...`. The bundled defaults under `/assets/*` are baked into the image
and need no mount.

Back up the data directory (and `public/`, if you use it) to preserve appointments and
settings across restarts. Database paths are configurable under `database` in `when.yaml`.

## Operating endpoints

Web app:

- `GET /healthz` — `200 OK` once the app is up.
- `GET /metrics` — Prometheus metrics (`prom-client`).

Worker:

- `GET /healthz` on its `PORT` (default `9000`) — `{"status":"ok"}`.

## Helper CLI (`when-cli`)

A command-line helper tool is available to bootstrap and manage `when.yaml`. Run it with `pnpm cli` on the host, or against a deployment with `docker compose -f apps/web/docker-compose.yml run --rm when-cli <args>`.

- **Create a starter config**:

  ```sh
  pnpm cli config init
  ```

  Interactive wizard that walks through auth, user, SMTP, one calendar, one schedule, and one meeting, writes a starter `when.yaml`, and prints the environment variables you still need to set. Refuses to overwrite an existing file.

- **Validate configuration**:

  ```sh
  pnpm cli config validate [path/to/when.yaml]
  ```

  Checks the file's shape and cross-references. Pass `--check-env` to also verify that every referenced environment variable is set (the full boot check). Exits non-zero on any failure.

- **Add a calendar**:

  ```sh
  pnpm cli calendars add google
  pnpm cli calendars add caldav
  pnpm cli calendars add nextcloud
  ```

  Interactive wizards that add and verify a calendar (Google requires a Google Cloud OAuth 2.0 Client ID of type "Desktop app") and update `when.yaml`.

- **Add a schedule**:

  ```sh
  pnpm cli schedules add
  ```

- **Add a meeting**:

  ```sh
  pnpm cli meetings add
  ```

- **Configure appearance**:

  ```sh
  pnpm cli appearance
  ```

  Interactive wizard for the booking page's branding — text, colors, assets, and font.
