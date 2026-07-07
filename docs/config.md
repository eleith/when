# Configuration

`config.yaml` is the heart of "When" — it drives authentication, branding,
availability, calendars, email, and the meetings people can book, without an admin
database for settings. This is the complete reference; the canonical source of truth is
defined in [schema.ts](file:///home/eleith/dev/when/packages/config/src/schema.ts) (TypeBox), and the generated JSON Schema is served live at `GET /schema/config.json`.

Point your editor at that schema for inline autocomplete and validation:

```yaml
# yaml-language-server: $schema=./config.schema.json
```

The required top-level keys are: `auth`, `user`, `smtp`, `calendars`, `availability`, `event_types`. Optional top-level keys include `services`, `video_chats`, `database`, `url`, and `prometheus`.

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

The schedule owner and the appointment page's branding.

```yaml
user:
  name: 'Your Name'
  email: 'you@example.com' # required, must be a valid email
  timezone: 'America/New_York' # required, IANA timezone identifier
  branding:
    page_title: 'Schedule a time with me'
    description: 'A little bit about me.'
    color:
      primary:
        light: '#ff5500'
        dark: '#ffaa66'
    logo_url: '/public/logo.png'
    avatar_url: '/public/my-avatar.jpg'
    favicon_url: '/public/favicon.ico'
```

`branding` and all of its fields are optional. `color.primary.light` and `color.primary.dark` specify hex primary colors used in light and dark modes, respectively; a muted tonal scale is derived from them. Place custom assets in `./data/public/`, which is served at `/public/`.

## `smtp`

**Required.** The worker sends all appointment emails over this server; the appointment system
relies on it.

```yaml
smtp:
  host: 'smtp.example.com'
  port: 587
  user: '${SMTP_USER}'
  pass: '${SMTP_PASS}'
```

## `services`

External APIs and auth credentials. Calendars and video chat integrations reference these services by `id`.

Three `type`s are supported: `google`, `caldav`, and `nextcloud`.

```yaml
services:
  - id: 'my-google-service'
    type: 'google'
    client_id: '${GOOGLE_CLIENT_ID}'
    client_secret: '${GOOGLE_CLIENT_SECRET}'
    refresh_token: '${GOOGLE_REFRESH_TOKEN}'
  - id: 'my-caldav-service'
    type: 'caldav'
    url: 'https://cloud.example.com/remote.php/dav/'
    username: 'jane'
    password: '${CALDAV_PASSWORD}'
  - id: 'my-nextcloud-service'
    type: 'nextcloud'
    url: 'https://nextcloud.example.com/'
    username: 'jane'
    password: '${NEXTCLOUD_PASSWORD}'
```

## `video_chats`

Video conferencing providers for meetings. Two `type`s are supported: `google-meet` and `nextcloud-talk`.

```yaml
video_chats:
  - id: 'meet'
    type: 'google-meet'
    service_id: 'my-google-service'
  - id: 'talk'
    type: 'nextcloud-talk'
    service_id: 'my-nextcloud-service'
```

## `calendars`

One or more external calendars, used as conflict sources (busy times) and/or appointment destinations.

```yaml
calendars:
  - id: 'work' # referenced by event types
    type: 'caldav'
    service_id: 'my-caldav-service'
    url: 'https://cloud.example.com/remote.php/dav/calendars/jane/work/'
    sync:
      refresh_interval: 10 # minutes between busy-time refreshes (default 10)
  - id: 'personal'
    type: 'google'
    service_id: 'my-google-service'
    google_calendar_id: 'primary'
    sync:
      refresh_interval: 10
```

`sync.refresh_interval` is optional on either type. For Google, run `pnpm cli calendar add google` to generate this block automatically.

## `availabilities`

A list of availability profiles. Each profile contains scheduling rules and weekly working hours.

```yaml
availabilities:
  - id: 'standard' # unique identifier referenced by event types
    slot_granularity: 15 # minutes; slots snap to this boundary (default 15)
    minimum_notice: 120 # minutes of lead time required (default 120)
    maximum_lookahead: 60 # days bookable into the future (default 60)
    buffer_before: 0 # minutes padded before a meeting (default 0)
    buffer_after: 0 # minutes padded after a meeting (default 0)
    max_appointments_per_day: null # cap on meetings per day; null = unlimited (default null)
    weekly: # required: weekly working hours
      monday: ['09:00-17:00']
      tuesday: ['09:00-17:00']
      wednesday: ['09:00-17:00']
      thursday: ['09:00-17:00']
      friday: ['09:00-13:00', '14:00-17:00'] # multiple blocks allowed
      # days omitted = no availability
```

## `event_types`

The meetings people can book. `id`, `name`, `duration`, `slug`, `appointment_flow`, `destination_calendar`, and `availability` are required; everything else is optional.

```yaml
event_types:
  - id: 'chat'
    name: '30-minute chat'
    duration: 30 # minutes
    slug: 'chat' # URL slug: /schedule/chat
    description: 'A quick intro call.'
    visibility: 'public' # 'public' (default) or 'private' (hidden from the homepage)
    appointment_flow: 'auto' # 'auto' or 'requires_confirmation'
    conflict_calendars: ['work', 'personal'] # busy-time sources (default [])
    destination_calendar: 'work' # where the appointment is written
    availability: 'standard' # references an availabilities profile id
    image_url: '/public/chat.png'
    location: 'Office Room 101' # a static URL, address, or phone number (optional)
    video_chat: 'meet' # references a video_chats id to generate dynamic meeting links (optional)
    note: 'Please review materials prior to the call.' # a host note shown to guests (optional)
    form_fields: # custom booking questions (optional, guest_name is required)
      - id: 'name'
        type: 'guest_name'
        label: 'Your Name'
        required: true
      - id: 'email'
        type: 'guest_email'
        label: 'Your Email'
        required: true
      - id: 'loc'
        type: 'event_location'
        label: 'Preferred Location'
        required: true
      - id: 'goals'
        type: 'paragraph'
        label: 'What would you like to discuss?'
        required: false

    # any availability knob may be overridden here; omit to inherit the profile value:
    slot_granularity: 30
    minimum_notice: 240
    maximum_lookahead: 30
    buffer_before: 5
    buffer_after: 5
    max_appointments_per_day: 4
```

### Custom Form Fields and Video Chats

Rather than rigid location structures, meetings are customized using:

- **Fixed Location**: A static string configured via `location`.
- **Dynamic Video Chat**: Setup under `video_chats` and linked to an event type using `video_chat: <id>`. Dynamic links are generated automatically.
- **Custom Questions**: Configured via `form_fields`. Every form **must** include exactly one `guest_name` field (with `required: true`). Optional special field types include `guest_email` and `event_location`. General text fields, numbers, paragraphs, and choices are also supported.

## `database`

On-disk SQLite paths. Relative paths resolve against this config file's directory, so the
web and worker (loading the same `config.yaml`) open the same files.

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
