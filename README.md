# When

Single-user appointment scheduling. Booking page, admin UI, CalDAV
integration, configurable via a YAML file.

## Quick start (Docker)

1. Copy `config.example.yaml` to `config.yaml` and fill it in.
2. Generate a password hash for the admin login (skip if using OIDC):

   ```sh
   bun run hash-password
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

5. Bring up the container:

   ```sh
   docker compose up -d
   ```

   The booking page is at `http://localhost:3000/`, the admin UI at
   `/admin`.

The container runs migrations on boot. SQLite lives at
`/app/data/when.db` inside the container; mount that path to a volume
to persist bookings across restarts (the bundled `docker-compose.yml`
mounts `./data`).

## Required environment variables

| Variable                | Required        | Notes                                                                                                                                |
| ----------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`           | always          | Auth.js JWT signing secret. 32+ random bytes, base64-encoded.                                                                        |
| `ENCRYPTION_KEY`        | production      | Base64 of 32 random bytes. Used to encrypt OAuth refresh tokens at the column level. In dev, an ephemeral key is generated + warned. |
| `ADMIN_PASSWORD_HASH`   | credentials auth | argon2id hash of the admin password. Generate with `bun run hash-password`.                                                          |
| `OIDC_CLIENT_SECRET`    | oidc auth       | OIDC provider client secret (any name works; whatever the yaml's `${...}` interpolation references).                                 |
| `CALDAV_PASSWORD`       | caldav calendar | CalDAV password / app password.                                                                                                      |
| `SMTP_USER` / `SMTP_PASS` | requires_confirmation events | SMTP credentials.                                                                                                                    |

Any string value in `config.yaml` may reference `${ENV_VAR}` and the
substitution happens before schema validation, so secrets stay in the
environment rather than on disk.

## Authentication

The `auth` block in `config.yaml` must declare exactly one of:

- **`credentials`** — username + argon2id password hash. Sign in with a
  username/password form at `/signin`.

  ```yaml
  auth:
    credentials:
      username: admin
      password_hash: '${ADMIN_PASSWORD_HASH}'
  ```

- **`oidc`** — issuer + client id/secret. Sign in via the configured
  identity provider.

  ```yaml
  auth:
    oidc:
      issuer: 'https://auth.example.com'
      client_id: 'when'
      client_secret: '${OIDC_CLIENT_SECRET}'
  ```

  The OIDC provider must allow `${origin}/auth/callback/oidc` as a
  redirect URL.

`AUTH_SECRET` is required for both modes (Auth.js JWT signing).

## Calendar integration

CalDAV calendars are supported as both **conflict sources** (busy times
to subtract from availability) and **destination** (where confirmed
bookings get written). Add one or more entries under `calendars:` and
reference them from event types.

```yaml
calendars:
  - id: 'work'
    type: 'caldav'
    url: 'https://cloud.example.com/remote.php/dav/calendars/jane/work/'
    username: 'jane'
    password: '${CALDAV_PASSWORD}'

event_types:
  - id: 'chat'
    name: '30-minute chat'
    duration: 30
    slug: 'chat'
    booking_flow: 'auto'
    conflict_calendars: ['work']
    destination_calendar: 'work'
```

Conflict pulls are cached in-process for ~60 seconds; the booking
submit re-fetches the slot's day to close the stale-cache window.

> **Google Calendar Support:** "When" fully supports Google Calendar. Because Google's OAuth requires a browser consent flow, we provide a CLI tool to generate your configuration without needing complex UI setups or database state. See the CLI helpers section below.

### Google Calendar Prerequisites
Before running the setup CLI, you must prepare a Google Cloud project:
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., "When Scheduling").
3. Go to **APIs & Services > Library** and enable the **Google Calendar API**.
4. Go to **APIs & Services > OAuth consent screen**:
   - Choose **External** and click Create.
   - Fill in the required app name and developer email fields.
   - **Crucial:** Under "Test users", add your personal `@gmail.com` email address.
5. Go to **APIs & Services > Credentials**:
   - Click **Create Credentials > OAuth client ID**.
   - **Crucial:** Select **Desktop app** as the Application type (do NOT select Web application).
   - Copy your `Client ID` and `Client Secret`.

## Email & confirmation flow

Event types with `booking_flow: requires_confirmation` need an `smtp:`
block. The booker submits the form, the admin gets an email with one-
click Accept / Decline links (and the same controls in `/admin`), and
on accept the booker receives a confirmation email with the `.ics`
attached.

```yaml
smtp:
  host: 'smtp.example.com'
  port: 587
  user: '${SMTP_USER}'
  pass: '${SMTP_PASS}'
```

Failures (SMTP unreachable, CalDAV push failed) are written to the
appointment's `notification_status` column and surfaced as a warning
icon in `/admin`.

## Availability

Default working hours live in `availability.default` (per weekday, in
`HH:MM-HH:MM` ranges). Knobs (`slot_granularity`, `minimum_notice`,
`maximum_lookahead`, `buffer_before`, `buffer_after`,
`max_bookings_per_day`) are global with per-event-type overrides.

Ad-hoc per-date overrides (vacation days, late starts) are managed
through the admin UI at `/admin/overrides`. They take precedence over
the YAML defaults for that date.

## Operating

- **Health**: `GET /healthz` returns `200 OK` once the app is up.
- **Metrics**: `GET /metrics` exposes Prometheus metrics
  (`prom-client`).
- **Schema**: `GET /schema/config.json` serves the current config
  schema for editor tooling (`yaml-language-server: $schema=...`).

## CLI helpers

Run inside the container or with `bun run` in a checkout:

- `bun run hash-password` — interactive prompt; emits an argon2id hash.
- `bun run setup-google` — interactive prompt; opens your browser to authenticate with Google and generates the required `config.yaml` block for a Google Calendar (requires a Google Cloud OAuth 2.0 Client ID of type "Desktop app").
- `bun run validate-config` — parses + validates `config.yaml` without
  starting the server. Exits non-zero on validation errors.

## Custom Branding & Assets

You can customize the appearance of your booking page by providing your own images (logos, avatars, favicons, or event-specific images) and referencing them in your `config.yaml`. 

To do this, create a `public` directory inside your `data` volume (`./data/public`) and place your image files there. Both the production and development Docker compose files are configured to mount this directory so that SvelteKit serves them as static assets under the `/public/` URL path.

For example, if you place `my-avatar.jpg` and `chat-icon.png` in `./data/public/`, your config would look like this:

```yaml
user:
  name: "Your Name"
  branding:
    page_title: "Schedule a time with me"
    description: "A little bit about me and **why** I want to schedule a meeting."
    avatar_url: "/public/my-avatar.jpg"
    favicon_url: "/public/favicon.ico"

event_types:
  - id: "chat"
    name: "30-minute chat"
    image_url: "/public/chat-icon.png"
```

## Local development

```sh
bun install
bun run dev
```

Or with hot-reload in Docker:

```sh
bun run dev:docker
```

Run the test suite:

```sh
bun test           # unit tests
bun run test:e2e   # Playwright (requires browsers installed)
```

## Architecture notes

- SQLite via `bun:sqlite` (Kysely query builder). Migrations run on
  boot and are idempotent.
- Availability calculation uses Temporal (`@js-temporal/polyfill`) for
  DST-correct timezone math.
- Outbound `.ics` and inbound CalDAV iCal both go through `ts-ics`.
- Single-process, single-user: no multi-tenancy, no team round-robin.
- Docker image is `linux/amd64` only.

## Documentation

For LLMs or AI agents working on this project, please consult [`AGENTS.md`](./AGENTS.md) for architectural constraints and coding guidelines.
