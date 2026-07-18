# Configuration

`when.yaml` is the heart of "When" — it drives authentication, branding,
availability, calendars, email, and the meetings people can book, without an admin
database for settings. This is the complete reference; the canonical source of truth is
defined in [schema.ts](file:///home/eleith/dev/when/packages/config/src/schema.ts) (TypeBox), which generates `config.schema.json` for editors to point at.

Point your editor at that schema for inline autocomplete and validation:

```yaml
# yaml-language-server: $schema=./config.schema.json
```

The required top-level keys are: `auth`, `user`, `smtp`, `calendars`, `schedules`, `meetings`. Optional top-level keys include `services`, `database`, `url`, and `prometheus`.

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

## `services`

External APIs and auth credentials. Calendars reference these services by `name`.

Three `type`s are supported: `google`, `caldav`, and `nextcloud`.

```yaml
services:
  - name: 'my-google-service'
    type: 'google'
    client_id: '${GOOGLE_CLIENT_ID}'
    client_secret: '${GOOGLE_CLIENT_SECRET}'
    refresh_token: '${GOOGLE_REFRESH_TOKEN}'
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
    service: 'my-caldav-service'
    url: 'https://cloud.example.com/remote.php/dav/calendars/jane/work/'
    sync:
      refresh_every_minutes: 10 # minutes between busy-time refreshes (default 10)
  - name: 'personal'
    type: 'google'
    service: 'my-google-service'
    google_calendar_id: 'primary'
    sync:
      refresh_every_minutes: 10
```

`sync.refresh_every_minutes` is optional on either type. For a Google service, mint the refresh token with `pnpm cli service token <name>`, and use `pnpm cli service calendars <name>` to find each `google_calendar_id`.

## `schedules`

A list of weekly schedules defining availability slots.

```yaml
schedules:
  - name: 'standard' # unique name referenced by meetings
    weekly: # optional; defaults to Monday–Friday 09:00–17:00 when omitted
      monday: ['09:00-17:00']
      tuesday: ['09:00-17:00']
      wednesday: ['09:00-17:00']
      thursday: ['09:00-17:00']
      friday: ['09:00-13:00', '14:00-17:00'] # multiple blocks allowed
      # omitted days have no availability; a schedule needs at least one window
```

## `meetings`

The meetings people can book. Only `name` is required: `duration_minutes` (30), `booking_approval` (`request`), `slug` (a slug of `name`), and `schedule`/`booking_calendar` (the first schedule/calendar) all default. Everything else is optional.

```yaml
meetings:
  - name: '30-minute chat'
    duration_minutes: 30 # minutes (default 30)
    slug: 'chat' # URL slug: /schedule/chat (defaults to a slug of the name)
    description: 'A quick intro call.'
    visibility: 'public' # 'public' (default) or 'private' (hidden from the homepage)
    booking_approval: 'request' # 'request' (default, requires host approval) or 'instant'
    busy_calendars: ['work', 'personal'] # busy-time calendar names to check for conflicts (default [])
    booking_calendar: 'work' # where the appointment is written (defaults to the first calendar)
    schedule: 'standard' # references a schedules name (defaults to the first schedule)
    location: 'Office Room 101' # a static URL, address, or phone number (optional)
    video_chat_service: 'my-nextcloud-service' # references a nextcloud or google service name to generate dynamic meeting links (optional)
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
- **Dynamic Video Chat**: Setup under `video_chat_service` referencing the service name (e.g. `my-nextcloud-service` or `my-google-service`). Dynamic links (like Nextcloud Talk rooms or Google Meet URLs) are generated automatically.
- **Custom Questions**: Configured via `form_fields`. Every form **must** include exactly one `guest_name` field (with `required: true`). Optional special field types include `guest_email` and `event_location`. General text fields, numbers, paragraphs, and choices are also supported.

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
  app: 'https://book.example.com' # public base URL (with scheme); used in emails + calendar events
  internal: 'http://when-app:3000' # base URL the worker uses to reach the web app internally (defaults to ${WHEN_URL_INTERNAL}; falls back to `app`)
  worker: 'http://when-worker:9000' # base URL the web app uses to reach the worker internally for telemetry and metrics (default 'http://when-worker:9000')
```

## `prometheus`

Configuration for Prometheus metrics collection.

```yaml
prometheus:
  enabled: false # Whether metrics collection and endpoint are active (default: false)
  secret: '${METRICS_TOKEN:-}' # Bearer token for scraping metrics (default: ${METRICS_TOKEN})
```
