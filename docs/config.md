# Configuration

`when.yaml` is the heart of "When" — it drives authentication, branding,
availability, calendars, email, and the meetings people can book, without an admin
database for settings. This is the complete reference; the canonical source of truth is
defined in [schema.ts](file:///home/eleith/dev/when/packages/config/src/schema.ts) (TypeBox), which generates `config.schema.json` for editors to point at.

Point your editor at that schema for inline autocomplete and validation:

```yaml
# yaml-language-server: $schema=./config.schema.json
```

The required top-level keys are: `auth`, `user`, `smtp`, `calendars`, `schedules`, `meetings`. Optional top-level keys include `version`, `providers`, `database`, `url`, and `prometheus`.

## `version`

The shape of this file, not the app's release. It defaults to `1` and you never need to
write it; it exists so a future change to the config layout can be detected rather than
guessed at. Only `1` is accepted today.

```yaml
version: 1
```

## Environment variable interpolation

Any string value may reference `${ENV_VAR}`. Substitution happens **before** validation,
so secrets stay in the environment rather than on disk. The `${VAR:-default}` form
supplies a fallback.

```yaml
auth:
  oidc:
    client_secret: '${OIDC_CLIENT_SECRET}'
```

## `auth`

Declare **exactly one** strategy for the `/admin` interface.

```yaml
# Local username/password:
auth:
  credentials:
    username: 'admin'
    password: '${WHEN_ADMIN_PASSWORD}' # defaults to WHEN_ADMIN_PASSWORD env var if omitted

# — or — single sign-on via OIDC:
auth:
  oidc:
    issuer: 'https://auth.example.com'
    client_id: 'when'
    client_secret: '${OIDC_CLIENT_SECRET}'
```

Both are supported in production. Which one fits depends on who can reach the sign-in page:

- **`credentials`** is a good fit on a trusted network — a LAN, a VPN, or behind a proxy that
  authenticates before the request arrives. The app applies **no rate limiting and no lockout**
  to password attempts, so nothing slows an attacker who can reach `/signin`. Running it in
  production logs one warning at startup saying so.
- **`oidc`** is the recommendation for an internet-facing deployment. Attempt throttling,
  lockout, password policy, and MFA then belong to your identity provider, which is built for
  them.

If you want `credentials` on a public address anyway, put the rate limiting at the reverse
proxy — see the sign-in endpoint in `docs/deployment.md`.

## `user`

The schedule owner and the appointment page's appearance.

```yaml
user:
  name: 'Your Name'
  email: 'you@example.com' # required, must be a valid email
  timezone: 'America/New_York' # IANA timezone; defaults to the TZ env var, or UTC
  appearance:
    title: 'Schedule a time with me'
    description: 'A little bit about me.'
    logo_url: '/public/logo.png'
    avatar_url: '/public/my-avatar.jpg'
    favicon_url: '/public/favicon.ico'
    font_name: 'Outfit' # custom CSS font family
    primary_light_color: '#166534' # brand hue, light mode
    primary_dark_color: '#34d399' # brand hue, dark mode
```

`appearance` and all of its fields are optional; defaults are applied when omitted. `logo_url` and `favicon_url` default to a bundled spiral-calendar mark (`/assets/images/logo.svg`, `/assets/images/favicon.svg`), and `avatar_url` defaults to `/assets/images/avatar.svg` — a placeholder avatar generated from `user.name`. `primary_light_color` and `primary_dark_color` set the brand hue for light and dark modes, and a muted tonal scale is derived from each; the `background_*_color` and `text_*_color` fields likewise override the light/dark surface and text colors. To override any of them, place custom assets in `./public/` (a sibling of `config/` and `data/`, overridable with `WHEN_PUBLIC_DIR`) and reference them as `/public/...`.

## `smtp`

**Required.** The worker sends all appointment emails over this server; the appointment system
relies on it.

```yaml
smtp:
  host: 'smtp.example.com'
  port: 587 # defaults to 587
  user: '${SMTP_USER}'
  pass: '${SMTP_PASS}'
```

## `providers`

External APIs and auth credentials. Calendars reference these providers by `name`.

Three `type`s are supported: `google`, `caldav`, and `nextcloud`.

```yaml
providers:
  - name: 'my-google-service'
    type: 'google'
    client_id: '${GOOGLE_CLIENT_ID}'
    client_secret: '${GOOGLE_CLIENT_SECRET}'
  - name: 'my-caldav-service'
    type: 'caldav'
    url: 'https://cloud.example.com/remote.php/dav/'
    username: 'jane'
    password: '${CALDAV_PASSWORD}'
  - name: 'my-nextcloud-service'
    type: 'nextcloud'
    url: 'https://nextcloud.example.com/'
    username: 'jane'
    password: '${NEXTCLOUD_PASSWORD}'
```

## `calendars`

One or more external calendars, used as conflict sources (busy times) and/or appointment destinations.

```yaml
calendars:
  - name: 'work' # referenced by meetings
    type: 'caldav'
    provider: 'my-caldav-service'
    url: 'https://cloud.example.com/remote.php/dav/calendars/jane/work/'
    sync:
      refresh_every_minutes: 10 # minutes between busy-time refreshes (default 10)
  - name: 'personal'
    type: 'google'
    provider: 'my-google-service'
    google_calendar_id: 'primary'
    sync:
      refresh_every_minutes: 10
```

`sync.refresh_every_minutes` is optional on either type. A Google provider carries no refresh token in `when.yaml` — connect it from `/admin` and the token is stored in the database.

## `schedules`

A list of weekly schedules defining availability slots. `weekly` is a list of
rules, each naming the `days` it applies to and a `from`/`to` window (24-hour
`HH:MM`, in `user.timezone`). Availability is the union of all rules.

```yaml
schedules:
  - name: 'standard' # unique name referenced by meetings
    weekly: # optional; defaults to Monday–Friday 09:00–17:00 when omitted
      - days: [mon, tue, wed, thu]
        from: '09:00'
        to: '17:00'
      # For multiple windows in a day (e.g. a lunch break), repeat the day:
      - days: [fri]
        from: '09:00'
        to: '13:00'
      - days: [fri]
        from: '14:00'
        to: '17:00'
      # A day named by no rule has no availability (here: sat, sun).
```

## `meetings`

The meetings people can book. `name`, `schedule`, and `booking_calendar` are required — every meeting names where it books and when. `duration_minutes` (30), `booking_approval` (`request`), and `slug` (a slug of `name`) all default; everything else is optional.

```yaml
meetings:
  - name: '30-minute chat'
    duration_minutes: 30 # minutes (default 30); or a list like [15, 30, 60] to let the guest choose the length
    slug: 'chat' # URL slug: /schedule/chat (defaults to a slug of the name)
    description: 'A quick intro call.'
    visibility: 'public' # 'public' (default) or 'unlisted' (kept off the homepage; the link still works)
    booking_approval: 'request' # 'request' (default, requires host approval) or 'instant'
    additional_busy_calendars: ['personal'] # further calendars to check for conflicts; booking_calendar is always checked (default [])
    booking_calendar: 'work' # required: where the appointment is written
    schedule: 'standard' # required: references a schedules name
    location: 'Office Room 101' # a static URL, address, or phone number (optional)
    video_chat_provider: 'my-nextcloud-service' # references a nextcloud or google provider name to generate dynamic meeting links (optional)
    note: 'Please review materials prior to the call.' # a host note shown to guests (optional)
    form_fields: # custom booking questions (optional)
      - name: 'name'
        type: 'guest_name'
        label: 'Your Name'
        required: true
      - name: 'email'
        type: 'guest_email'
        label: 'Your Email'
        required: true
      - name: 'loc'
        type: 'event_location'
        label: 'Preferred Location'
        required: true
      - name: 'goals'
        type: 'paragraph'
        label: 'What would you like to discuss?'
        required: false
      - name: 'contact_method'
        type: 'choice'
        label: 'How should we reach you?'
        required: true
        choices: ['phone', 'email']
      - name: 'phone'
        type: 'phone'
        label: 'Your phone number'
        required: true # required only while shown
        show_when: # show only when every condition holds (AND)
          - field: 'contact_method' # references an earlier field by name
            equals: 'phone' # a single value, or a list for "one of"; omit to mean "filled at all"

    # Scheduling rules:
    start_times_every_minutes: 30 # slots snap to this boundary (defaults to duration_minutes)
    notice_minutes: 120 # minutes of lead time required (default 120)
    booking_window_days: 60 # days bookable into the future (default 60)
    padding_before_minutes: 0 # minutes padded before a meeting (default 0)
    padding_after_minutes: 0 # minutes padded after a meeting (default 0)
    daily_booking_limit: null # cap on meetings per day; null = unlimited (default null)
```

### Custom Form Fields and Video Chats

Rather than rigid location structures, meetings are customized using:

- **Fixed Location**: A static string configured via `location`.
- **Dynamic Video Chat**: Setup under `video_chat_provider` referencing the provider name (e.g. `my-nextcloud-service` or `my-google-service`). Dynamic links (like Nextcloud Talk rooms or Google Meet URLs) are generated automatically.
- **Custom Questions**: Configured via `form_fields`. Every form **must** include exactly one `guest_name` field (with `required: true`). Optional special field types include `guest_email` and `event_location`. General text fields, numbers, phone numbers, paragraphs, and choices are also supported. A field may be shown conditionally with `show_when`: a list of `{ field, equals }` conditions (all must hold) referencing earlier fields. Omit `equals` to require only that the referenced field is filled, or give it a list to accept any of several values. A field hidden by `show_when` is never required and its answer is not recorded.

## `database`

On-disk SQLite paths. Relative paths resolve against the config directory's parent — the
deployment root that holds `config/` and `data/` as siblings — so the web and worker
(loading the same `when.yaml`) open the same files.

```yaml
database:
  app: './data/when.sqlite' # appointments, OAuth tokens (default)
  queue: './data/openworkflow.sqlite' # background job queue (default)
```

## `url`

Public URLs and internal network endpoints for service-to-service communication.

```yaml
url:
  app: 'https://book.example.com' # public base URL (with scheme); used in emails + calendar events (defaults to ${ORIGIN})
  internal: 'http://when-app:3000' # base URL the worker uses to reach the web app internally (defaults to ${WHEN_URL_INTERNAL}; falls back to `app`)
  worker: 'http://when-worker:9000' # base URL the web app uses to reach the worker internally for telemetry and metrics (default 'http://when-worker:9000')
```

Usually you can omit `app` entirely. It defaults to the `ORIGIN` env var, which
`adapter-node` requires anyway to run behind a reverse proxy (see
[`deployment.md`](deployment.md)) — so `ORIGIN` alone keeps both in sync.

## `prometheus`

Configuration for Prometheus metrics collection.

```yaml
prometheus:
  enabled: false # Whether metrics collection and endpoint are active (default: false)
  secret: '${METRICS_TOKEN:-}' # Bearer token for scraping metrics (default: ${METRICS_TOKEN})
```
