# When

Single-user appointment scheduling. Booking page, admin UI, CalDAV
integration, configurable via a YAML file.

"When" runs as two services: the **web** app and a background **worker** that
sends booking emails off the request path. They share one `config.yaml` and
data dir (the worker drains the job queue web writes to). The bundled
`apps/web/docker-compose.yml` runs both.

## Quick start (Docker)

1. Copy `apps/web/config.example.yaml` to `apps/web/config.yaml` and fill it in.
2. Generate a password hash for the admin login (skip if using OIDC):

   ```sh
   pnpm hash-password
   ```

   Save the output as `ADMIN_PASSWORD_HASH` in your environment.

3. Generate a 32-byte base64 encryption key:

   ```sh
   openssl rand -base64 32
   ```

   Save it as `ENCRYPTION_KEY`.

4. Generate a 32-byte base64 auth secret:

   ```sh
   openssl rand -base64 32
   ```

   Save it as `AUTH_SECRET`.

5. Bring up the services (web + worker):

   ```sh
   docker compose -f apps/web/docker-compose.yml up -d
   ```

   The booking page is at `http://localhost:3000/`, the admin UI at
   `/admin`. The worker delivers booking emails in the background.

The container runs migrations on boot. SQLite lives at
`/app/data/when.db` inside the container; mount that path to a volume
to persist bookings across restarts (the bundled `docker-compose.yml`
mounts `./data`).

## Required environment variables

| Variable                | Required        | Notes                                                                                                                                |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`           | always          | Auth.js JWT signing secret. 32+ random bytes, base64-encoded.                                                                        |
| `ENCRYPTION_KEY`        | production      | Base64 of 32 random bytes. Used to encrypt OAuth refresh tokens at the column level. In dev, an ephemeral key is generated + warned. |
| `ADMIN_PASSWORD_HASH`   | credentials auth | argon2id hash of the admin password. Generate with `pnpm hash-password`.                                                          |
| `OIDC_CLIENT_SECRET`    | oidc auth       | OIDC provider client secret (any name works; whatever the yaml's `${...}` interpolation references).                                 |
| `CALDAV_PASSWORD`       | caldav calendar | CalDAV password / app password.                                                                                                      |
| `SMTP_USER` / `SMTP_PASS` | booking emails  | SMTP credentials. The worker sends all booking emails; without SMTP configured, none are sent.                                       |

Any string value in `config.yaml` may reference `${ENV_VAR}` and the
substitution happens before schema validation, so secrets stay in the
environment rather than on disk.

## Documentation

For full details on configuring "When" and developing for it, please see the `docs/` directory:

- [Configuration Guide](docs/config.md) - Details on Auth, Calendars, Email, and Event Types.
- [Architecture Guidelines](docs/architecture.md) - For developers and AI agents working on the codebase.

## Operating

- **Health**: `GET /healthz` returns `200 OK` once the app is up.
- **Metrics**: `GET /metrics` exposes Prometheus metrics
  (`prom-client`).
- **Schema**: `GET /schema/config.json` serves the current config
  schema for editor tooling (`yaml-language-server: $schema=...`).

## CLI helpers

Run inside the container or with `pnpm` in a checkout:

- `pnpm hash-password` — interactive prompt; emits an argon2id hash.
- `pnpm setup-google` — interactive prompt; opens your browser to authenticate with Google and generates the required `config.yaml` block for a Google Calendar (requires a Google Cloud OAuth 2.0 Client ID of type "Desktop app").
- `pnpm validate-config` — parses + validates `config.yaml` without
  starting the server. Exits non-zero on validation errors.

## Local development

```sh
pnpm install
pnpm dev
```

`pnpm dev` runs only the web app. To also deliver booking emails locally, run
the worker against the same config in a second terminal:

```sh
CONFIG_PATH=apps/web/config.yaml pnpm --filter @when/worker dev
```

See [`apps/worker/README.md`](apps/worker/README.md) for details.

Or with hot-reload in Docker:

```sh
pnpm dev:docker
```

Run the test suite:

```sh
pnpm test          # unit tests (Vitest)
pnpm test:e2e      # Playwright (requires browsers installed)
```
