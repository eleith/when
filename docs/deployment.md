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

| Variable                             | Needed when                 | Notes                                                                                         |
| ------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------- |
| `WHEN_ADMIN_PASSWORD`                | credentials auth            | Plain text password of the admin (defaults to this if omitted in config).                     |
| `WHEN_OIDC_CLIENT_SECRET`            | OIDC auth                   | OIDC provider client secret.                                                                  |
| `WHEN_SMTP_PASSWORD`                 | always                      | SMTP password — SMTP is required.                                                             |
| `WHEN_PROVIDER_<NAME>_PASSWORD`      | a CalDAV/Nextcloud provider | CalDAV / Nextcloud provider password.                                                         |
| `WHEN_PROVIDER_<NAME>_CLIENT_SECRET` | a Google provider           | Client secret from Google Cloud.                                                              |
| `WHEN_PROVIDER_<NAME>_REFRESH_TOKEN` | a connected Google provider | Refresh token. You do not invent this one — `/admin` shows it after you authorize. See below. |

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

- `when.sqlite` — appointments, mirrored busy times, and service status (shared by web + worker).
- `openworkflow.sqlite` — the background job queue (shared by web/CLI producers and worker).

Branding overrides live in a separate `public/` directory mounted alongside
(`./public` → `/app/public`, overridable with `WHEN_PUBLIC_DIR`); the web app serves
them at `/public/...`. The bundled defaults under `/assets/*` are baked into the image
and need no mount.

Back up both databases consistently using SQLite-aware backup handling, not live file
copies that omit committed WAL data. Include `when.yaml`, its environment secrets, and
`public/` overrides separately. Database paths are configurable under `database`.
Both databases are sensitive: the queue includes prepared email envelopes, personal data
and guest capability links. Encrypt off-host backups and restrict local access.

## Grouped workflow rollout

Deploy web, worker and CLI as one stopped, grouped release. Do not deploy intermediate
PR images automatically; release/version/tag operations require separate authorization.
Application tests and the read-only drain/backup procedure are the gates, not an
assumption of old/new queue compatibility.

1. **Verify the release.** Run affected jobs/worker/web/CLI checks, lint, coverage and
   builds, workspace checks and browser regressions. Confirm both CI paths execute the
   co-located integration tests. Keep the currently deployed artifacts available.
2. **Stop producers**, including web, CLI commands and any other enqueuers. Let the
   **old worker** drain every unfinished old run. Worker shutdown alone is not draining:
   future pending jobs, parked retries/parents, running jobs and legacy `sleeping` work
   all count. Inspect the old queue read-only; do not initialize the new jobs client,
   since connection runs migrations. If recurring dispatch exists, pause it with the
   matching deployed API so the queue can drain.
3. **Halt if it cannot drain.** Require an explicit operator retry/cancel/reset decision
   after reviewing local and remote state. Never automatically wipe/reset a queue, even
   an apparently empty one, edit checkpoints, or resume changed old application graphs.
   Inspect again after any authorized action; cancelling a parent need not cancel its
   already-started children.
4. **Stop the old worker**, recheck that no unfinished runs remain, then take a consistent
   paired app/queue backup while all writers stay stopped. Include committed WAL data
   with SQLite-aware handling and verify restoration on copies (examples below).
5. **Deploy the grouped artifacts once**, against the same config and database paths,
   with no old worker or competing maintenance timers. Native `worker.start()` persists
   schedules and preserves pause; startup then enqueues all three `{}` passes without
   options, independently of pause. Inspect startup passes, schedules, service status
   and queue progress. Cron catches up once per overdue schedule and can coexist with
   startup work. Repeated scans are not coalesced; slow active maintenance blocks other
   jobs at concurrency one, while native retry waits park. Do not replay old graphs or
   automatically rerun terminal history; dedup may return an existing terminal run.
6. **Rollback only with evidence.** Use a proven compatible binary, or obtain explicit
   approval for restoring the paired backups and losing all later writes. Old binaries
   are not assumed compatible with migrated queues. Stop every writer before a paired
   restore; restore into clean destinations without stale WAL/SHM sidecars. Remote
   calendar/email effects are not undone by restoring SQLite.

### Read-only drain inspection

Set `QUEUE` to the actual old queue path. With the SQLite CLI, inspect the schema first:

```sh
sqlite3 -readonly "$QUEUE" '.schema workflow_runs'
```

The installed `0.11.0` schema uses `workflow_runs`, with `namespace_id`, `id`,
`workflow_name`, `status`, and `available_at`. Verify these columns against the deployed
schema; a mismatch requires investigation, not opening it with a newer client. Installed
public status types/terminal logic recognize `completed`, legacy `succeeded`, `failed`,
and **`canceled`** (one l) as terminal. `pending`, `running`, and legacy `sleeping` are
unfinished. Unknown statuses halt the rollout, even if they look terminal.

```sh
sqlite3 -readonly -header -column "$QUEUE" <<'SQL'
PRAGMA query_only = ON;
SELECT status, COUNT(*) AS runs FROM workflow_runs GROUP BY status;
SELECT namespace_id, id, workflow_name, status, available_at
FROM workflow_runs
WHERE status NOT IN ('completed', 'succeeded', 'failed', 'canceled')
ORDER BY namespace_id, created_at, id;
SQL
```

Proceed only when the second query returns no rows and every observed status is known.
There is deliberately **no due-time filter**: future pending work is unfinished. Inspect
all namespaces and child runs, not just top-level appointment runs. Do not dump inputs,
envelopes, errors or capability links into shared logs.

### Paired backup and restore check

With producers and worker stopped, set `APP`, `QUEUE`, and `BACKUP` to the real paths
and a fresh restricted backup directory. For ordinary paths without single quotes:

```sh
mkdir -m 700 "$BACKUP"
sqlite3 -readonly "$APP" ".backup '$BACKUP/when.sqlite'"
sqlite3 -readonly "$QUEUE" ".backup '$BACKUP/openworkflow.sqlite'"
mkdir -m 700 "$BACKUP/restore-check"
cp "$BACKUP/when.sqlite" "$BACKUP/restore-check/when.sqlite"
cp "$BACKUP/openworkflow.sqlite" "$BACKUP/restore-check/openworkflow.sqlite"
sqlite3 -readonly "$BACKUP/restore-check/when.sqlite" 'PRAGMA integrity_check;'
sqlite3 -readonly "$BACKUP/restore-check/openworkflow.sqlite" 'PRAGMA integrity_check;'
```

Both integrity checks must report `ok`. Compare restored appointment counts and queue
status counts to the stopped sources, and rerun drain inspection on the restored queue.
SQLite `.backup` includes committed WAL state; do not copy live main files alone or
remove source WAL files to make backups look clean. Because every writer is stopped,
the sequential backups form a consistent pair. Keep that pair together; test copies
must never reach real providers or become the running deployment.

### Interpreting outcomes

An email action `failed` is an **observed provider attempt**, possibly followed by retries
and recovery; local errors are not provider-failure observations. `done` requires a
nonempty intended set where every delivery reported `sent` and the row is still eligible
at the final write. Mixed/all skipped sets and missing/purged rows get no summary.
Engine history is authoritative for terminal failure; no aggregate terminal email-failure
summary is synthesized. An already-started sibling can continue independently. SMTP
service status is the **last recorded physical attempt outcome**, not an aggregate
recipient/job result. Its timestamps describe the send attempt, not a later status-write
retry. A delayed success write can overwrite a newer failure and move the recorded
timestamps backwards; this is not a time-ordered health history.
Handler metrics include replays/suspensions; email metrics count
physical attempt outcomes. Crashes before checkpoints can duplicate effects or log
entries: this is at-least-once execution, not an exactly-once ledger.

A failed purge retains the current and later hidden `purged` rows, including local
personal data. Earlier successful deletions remain deleted. Web selection skips
already-purged rows, so clicking purge again is not promised recovery. Review retained
rows, engine history and remote state before choosing explicit operator cleanup; there
is no automatic terminal rerun or remote-orphan fallback. A completed maintenance pass
likewise does not guarantee every provider succeeded. See the
[worker README](../apps/worker/README.md#maintenance-and-shutdown) for cadence and the
[jobs README](../packages/jobs/README.md#schedule-management) for public schedule management.

## Config reloads

`when.yaml` is watched, and most edits are applied in place. Changes under `auth` or `database`
cannot be — the auth provider and the database connections are built once at boot — so the app
logs `config change requires a restart` and exits **0**, expecting the supervisor to bring it
back. Compose does, via `restart: unless-stopped`.

If you run the built server under something else, make sure a clean exit restarts it. A systemd
unit with `Restart=on-failure` will _not_, and the app will simply stop after an `auth` or
`database` edit. Use `Restart=always`.

## Connecting a Google provider

Google needs a browser round-trip, so this one credential cannot come from `when.yaml`
alone. The flow ends by handing it to you rather than storing it:

1. Configure the provider's `client_id` and `client_secret`, and register
   `<your app url>/admin/services/google/callback` as an authorized redirect URI in Google
   Cloud. `/admin/health` shows the exact URI to paste.
2. Press **Connect** on `/admin/health` and complete Google's consent screen.
3. The callback shows the refresh token **once**. Put it in `.env` as
   `WHEN_PROVIDER_<NAME>_REFRESH_TOKEN`, and reference it from the provider's
   `refresh_token` field in `when.yaml`.
4. Recreate the containers: `docker compose -f apps/web/docker-compose.yml up -d`.

That last step is the one that catches people. **`docker compose restart` is not enough.**
Compose reads `.env` when it _creates_ a container, so restarting the container you already
have keeps the environment it was born with. Only `up -d` recreates it. Under systemd or
another supervisor, the equivalent is whatever re-reads your environment file — a plain
service restart may not.

Because `when.yaml` is watched but `.env` is not, editing the config first is the wrong
order: the watcher reloads, the env var is still unset, and interpolation fails with
`when.yaml references unset environment variables`. The reload is rejected and the old
config kept, which looks like nothing happening. Two ways to avoid it — keep the
`refresh_token` line in `when.yaml` from the start using the `:-` fallback form that
`config/when.example.yml` ships (then connecting is a single `.env` edit), or edit both
files and recreate in one go.

To disconnect, press **Disconnect**: it revokes the grant at Google and then tells you to
clear the env var yourself. Emptying the value is enough to read as not connected.

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
Google provider happens at `/admin/health`, which shows you the token to save.
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
