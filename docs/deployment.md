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
uses simple names like `${SMTP_PASSWORD}`). The table below lists the names used by the
skeleton `config init` writes; `<NAME>` is the service's name upper-cased. You set these
values yourself (the Google refresh token is minted by `service token <name>`).

| Variable                                                                                | Needed when            | Notes                                                                       |
| --------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `WHEN_ADMIN_PASSWORD`                                                                   | credentials auth       | Plain text password of the admin (defaults to this if omitted in config).   |
| `WHEN_OIDC_CLIENT_SECRET`                                                               | OIDC auth              | OIDC provider client secret.                                                |
| `WHEN_SERVICE_CALDAV_<NAME>_PASSWORD` / `WHEN_SERVICE_NEXTCLOUD_<NAME>_PASSWORD`        | a CalDAV/Nextcloud cal | CalDAV / Nextcloud service password.                                        |
| `WHEN_SMTP_PASS`                                                                        | always                 | SMTP password — SMTP is required.                                           |
| `WHEN_SERVICE_GOOGLE_<NAME>_CLIENT_SECRET` / `WHEN_SERVICE_GOOGLE_<NAME>_REFRESH_TOKEN` | a Google service       | Client secret from Google Cloud; refresh token from `service token <name>`. |

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

You author `when.yaml` yourself — start from `config/when.example.yml`, which
documents every option (and carries a `$schema` header for editor autocomplete).
`when-cli` is an operator's toolkit for the parts a text editor can't do: it
validates the file, reaches your services over the network, and mints the one
credential you can't type by hand. Run it with `pnpm cli` on the host, or against
a deployment with `docker compose -f apps/web/docker-compose.yml run --rm when-cli <args>`.

Every command takes `-c/--config <path>` (defaults to the standard config location).

- **Scaffold a starter config** — writes a minimal valid `when.yaml` (placeholders
  - `${...}` env refs); refuses to overwrite. Edit it, then validate.

  ```sh
  pnpm cli config init
  ```

- **Validate** — shape + cross-references. `--check-env` also verifies every
  referenced env var is set (the full boot check). Exits non-zero on failure.

  ```sh
  pnpm cli config validate [path/to/when.yaml]
  pnpm cli config validate --check-env
  ```

- **Services** — list configured services, authenticate one, list the calendars it
  exposes (to fill `google_calendar_id` / a CalDAV `path`), or mint a Google refresh
  token (google only — reads client_id/secret from the service, prints the env var to
  set; writes nothing).

  ```sh
  pnpm cli service list
  pnpm cli service test <name>
  pnpm cli service calendars <name>
  pnpm cli service token <name>
  ```

- **Calendars** — list configured calendars, or fetch busy intervals from one to
  confirm it's reachable.

  ```sh
  pnpm cli calendar list
  pnpm cli calendar test <name>
  ```

- **Email** — render and send a real test email through the worker (proves your
  SMTP + branding + templates work). Requires the worker to be running; it's
  triggered as a background job.

  ```sh
  pnpm cli email test you@example.com
  ```
