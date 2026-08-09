# Deployment

Running "When" in production. The bundled `apps/web/docker-compose.yml` runs both
services (web + worker) against one `when.yaml` and data directory. See
[`README.md`](../README.md) for the quick start and [`config.md`](config.md) for the
config reference.

## Environment variables

Both compose files deliver the environment from `apps/web/.env` via `env_file:` — start
from the tracked `apps/web/.env.example`. Nothing is baked into the image, so the same
image runs against whatever `.env` you bring. Compose's auto-loaded `.env` only
substitutes `${VAR}` inside the compose YAML itself; `env_file:` is what populates the
container's environment.

A few variables are read **directly** by the app from the environment:

| Variable      | Required       | Notes                                                                                                                                                                                                                                                                                                                              |
| ------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET` | always         | Auth.js JWT signing secret. 32+ random bytes, base64-encoded (`openssl rand -base64 32`).                                                                                                                                                                                                                                          |
| `ORIGIN`      | behind a proxy | Public base URL, no trailing slash. `adapter-node` otherwise derives the origin from the inbound `Host` header, which a TLS-terminating proxy makes `http://…` while the browser sends `https://…` — SvelteKit's CSRF check then rejects every form POST with a 403. Also the default for `url.app`, so setting it here is enough. |

`ORIGIN` and `url.app` in `when.yaml` are the same value — your public base URL. Set
`ORIGIN` and leave `url.app` unset: `adapter-node` reads `ORIGIN` from the environment
before any app code runs, so it can only travel in that direction. If you do set both,
keep them identical; a mismatch means correct links in emails and 403s on every form.

Everything else is a **secret referenced from `when.yaml`** via `${ENV_VAR}`
interpolation — the variable _names_ are whatever your config uses. The table below lists
the names both `config init` and `config/when.example.yml` write; `<NAME>` is the
provider's key upper-cased, with `-` as `_` (so the `caldav-service` provider reads
`WHEN_PROVIDER_CALDAV_SERVICE_PASSWORD`). You set these values yourself.

| Variable                             | Needed when             | Notes                                                                                                                                       |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `WHEN_ADMIN_PASSWORD`                | credentials auth        | Plain text password of the admin (defaults to this if omitted in config).                                                                   |
| `WHEN_OIDC_CLIENT_SECRET`            | OIDC auth               | OIDC provider client secret.                                                                                                                |
| `WHEN_SMTP_PASSWORD`                 | always                  | SMTP password — SMTP is required.                                                                                                           |
| `WHEN_PROVIDER_<NAME>_PASSWORD`      | a CalDAV/Nextcloud provider | CalDAV / Nextcloud provider password.                                                                                                   |
| `WHEN_PROVIDER_<NAME>_CLIENT_SECRET` | a Google provider       | Client secret from Google Cloud. The refresh token is not an env var — connect the provider from `/admin` and it is stored in the database. |

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
cp apps/web/.env.example apps/web/.env   # then fill it in
docker compose -f apps/web/docker-compose.yml up -d
```

`.env` must exist — compose refuses to start without the file it is told to load.

This brings up the web app (appointment page at \`/\`, admin at \`/admin\`) and the worker
(calendar sync + email delivery). Both run database migrations relevant to their role on
boot.

## Behind a reverse proxy

The app speaks plain HTTP on port 3000 and terminates no TLS of its own, so any
internet-facing deployment puts a proxy in front. Below is the split of who owns what.

### Required of the deployment

- **Set `ORIGIN`** to the public base URL. Without it the app derives its origin from the
  inbound `Host` header, which a TLS-terminating proxy reports as `http://…` while the
  browser sends `Origin: https://…`; SvelteKit compares the two and rejects **every** form
  POST with a 403 — booking, cancel, reschedule, sign-in, and the admin bulk actions.
- **The proxy must set `Host` from its own configuration** and must not forward a
  client-supplied value. With `ORIGIN` set the app ignores `Host` when building the request
  URL, which is also what makes Auth.js's `trustHost: true` safe — OIDC callback URLs are
  then built from a pinned origin rather than an attacker-influenceable header.
- **Point the proxy's upstream health check at `GET /healthz`** on the web app.

You do **not** need `PROTOCOL_HEADER` or `HOST_HEADER`: those exist to reconstruct the
origin from forwarded headers, and a set `ORIGIN` takes precedence over both. Likewise
`ADDRESS_HEADER` and `XFF_DEPTH` — the app never reads the client address.

### Owned by the proxy

- **TLS termination** and the HTTP → HTTPS redirect.
- **`Strict-Transport-Security`.** Deliberately not sent by the app; it is meaningless on
  the plaintext hop and belongs to whatever terminates TLS.
- **Rate limiting.** The app does none. The endpoints worth a rule are the unauthenticated
  ones: `POST /schedule/<slug>` (each success writes a row _and_ sends mail over your SMTP
  credentials, so abuse costs sender reputation), `POST /appointment/<id>` and
  `POST /appointment/<id>/reschedule`, and the sign-in POST when `auth.credentials` is in
  use — the app performs no lockout or throttling on password attempts. It warns once at
  startup when credentials auth runs in production; a rule here, or OIDC instead, is the
  answer. See the `auth` section of `docs/config.md`.
- **Response caching** for `/assets/images/opengraph.png` and `/assets/images/avatar.svg`,
  which are rendered per request, and for `/public/*`.
- **Request body limits**, if you set any: keep them at or above the app's own
  `BODY_SIZE_LIMIT` (512K by default) so oversized requests produce the app's error rather
  than the proxy's.

### Security headers

The app sends these itself, so it is safe without a proxy in front of it:

- `Content-Security-Policy`, including `frame-ancestors 'none'` — which supersedes
  `X-Frame-Options`, so you do not need that header at all.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `X-Content-Type-Options: nosniff`.

**Never set `Content-Security-Policy` at the proxy.** Two CSP headers are not
last-one-wins — the browser enforces both and the page gets their intersection. SvelteKit
mints a per-request nonce for its hydration script and the booking page carries an injected
inline `<style>` for the configured theme, neither of which a proxy can account for, so a
second policy will break rendering.

The other two are yours to duplicate if your standard vhost sets them. A proxy that replaces
headers wins outright; one that appends (bare nginx `add_header`) leaves two values and the
browser takes the last valid one. Either way the app's value is the fallback, not the winner,
so make sure yours is at least as strict. For `Referrer-Policy` that matters: guest
appointment links carry their access token in the query string, and anything weaker than
`strict-origin-when-cross-origin` leaks a working credential in the `Referer` of an outbound
click.

The app's policy allows no remote origin at all. Every `appearance.*_path` is a root-relative
path this app serves, so custom branding goes in `./public/` and is referenced at `/public/…`.

### Ports

Publish only the web app's 3000. The worker's port (`9000` by default) is internal-only and
the bundled `docker-compose.yml` correctly does not publish it: its `GET /healthz` is
unauthenticated by design, for the container liveness check. Its `/metrics` is bearer-gated
and served only when `prometheus.enabled` is true, but the port should still never be
reachable from outside the compose network.

The web app's `/metrics` is bearer-gated the same way. If you scrape it through the proxy,
keep it off the public vhost or restrict it by source address — the bearer token is the only
thing in front of it.

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

## Config reloads

`when.yaml` is watched, and most edits are applied in place. Changes under `auth` or `database`
cannot be — the auth provider and the database connections are built once at boot — so the app
logs `config change requires a restart` and exits **0**, expecting the supervisor to bring it
back. Compose does, via `restart: unless-stopped`.

If you run the built server under something else, make sure a clean exit restarts it. A systemd
unit with `Restart=on-failure` will _not_, and the app will simply stop after an `auth` or
`database` edit. Use `Restart=always`.

## Operating endpoints

Web app:

- `GET /healthz` — `200 OK` once the app is up.
- `GET /metrics` — Prometheus metrics (`prom-client`).

Worker:

- `GET /healthz` on its `PORT` (default `9000`) — `{"status":"ok"}`.

## Helper CLI (`when-cli`)

You author `when.yaml` yourself — start from `config/when.example.yml`, which
documents every option (and carries a `$schema` header for editor autocomplete).
`when-cli` is an operator's toolkit for the parts a text editor can't do: it validates
the file and reaches your services over the network. It is read-only — connecting a
Google provider happens at `/admin/health`, which is also where the token is stored.
Run it with `pnpm cli` on the host, or against a deployment with
`docker compose -f apps/web/docker-compose.yml run --rm when-cli <args>`.

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

- **Providers** — report what has been observed about each provider, authenticate one, or
  list the calendars it exposes (to fill `google_calendar_id` / a CalDAV `path`).

  `provider list` reads the stored status and touches no network. `provider test` and
  `provider calendars` run in the worker, which holds the credentials and records the
  result — so a manual check shows up on `/admin/health` the same as the worker's own,
  and needs a running worker.

  ```sh
  pnpm cli provider list
  pnpm cli provider test <name>
  pnpm cli provider calendars <name>
  ```

- **Calendars** — list configured calendars, or refresh one through the worker to confirm
  it is reachable. `calendar test` is a refresh a human asked for: it updates the busy
  mirror and records the outcome, so it doubles as "sync this now".

  ```sh
  pnpm cli calendar list
  pnpm cli calendar test <name>
  ```

  No command takes a refresh token. The worker reads the one `/admin/health` stored.

- **Database** — report the schema state, or apply pending migrations. Web and the worker
  both migrate at boot; this is the way in when neither will start.

  ```sh
  pnpm cli db status
  pnpm cli db migrate
  ```

- **Email** — render and send a real test email through the worker (proves your
  SMTP + branding + templates work). Requires the worker to be running; it's
  triggered as a background job.

  ```sh
  pnpm cli email test you@example.com
  ```
