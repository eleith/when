# Configuration

`config.yaml` is the heart of "When" — it drives authentication, branding,
availability, calendars, email, and the meetings people can book, without an admin
database for settings. This is the complete reference; the canonical source of truth is
the JSON Schema in `packages/config/src/config.schema.json`, also served live at
`GET /schema/config.json`.

Point your editor at that schema for inline autocomplete and validation:

```yaml
# yaml-language-server: $schema=./config.schema.json
```

All eight top-level keys are **required**: `auth`, `user`, `smtp`, `calendars`,
`availability`, `event_types`, `database`, `url`.

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
    password_hash: '${ADMIN_PASSWORD_HASH}' # generate with `pnpm hash-password`

# — or — single sign-on via OIDC:
auth:
  oidc:
    issuer: 'https://auth.example.com'
    client_id: 'when'
    client_secret: '${OIDC_CLIENT_SECRET}'
```

## `user`

The schedule owner and the booking page's branding.

```yaml
user:
  name: 'Your Name'
  email: 'you@example.com' # required, must be a valid email
  timezone: 'America/New_York' # required, IANA timezone identifier
  branding:
    page_title: 'Schedule a time with me'
    description: 'A little bit about me.'
    primary_color: '#ff5500' # see below
    logo_url: '/public/logo.png'
    avatar_url: '/public/my-avatar.jpg'
    favicon_url: '/public/favicon.ico'
```

`branding` and all of its fields are optional. `primary_color` is either a single hex
string used in both light and dark modes, or an object with `light` and `dark` hex
values; a muted tonal scale is derived from it. Place custom assets in `./data/public/`,
which is served at `/public/`.

## `smtp`

**Required.** The worker sends all booking emails over this server; the booking system
relies on it.

```yaml
smtp:
  host: 'smtp.example.com'
  port: 587
  user: '${SMTP_USER}'
  pass: '${SMTP_PASS}'
```

## `calendars`

One or more external calendars, used as conflict sources (busy times) and/or booking
destinations. Two `type`s are supported.

```yaml
calendars:
  - id: 'work' # referenced by event types
    type: 'caldav'
    url: 'https://cloud.example.com/remote.php/dav/calendars/jane/work/'
    username: 'jane'
    password: '${CALDAV_PASSWORD}'
  - id: 'personal'
    type: 'google'
    client_id: '${GOOGLE_CLIENT_ID}'
    client_secret: '${GOOGLE_CLIENT_SECRET}'
    refresh_token: '${GOOGLE_REFRESH_TOKEN}'
    google_calendar_id: 'primary'
    sync:
      refresh_interval: 10 # minutes between busy-time refreshes (default 10)
```

`sync.refresh_interval` is optional on either type. For Google, run `pnpm setup-google`
to generate this block automatically.

## `availability`

Global scheduling rules. Every knob except `default` has a default and can be overridden
per event type.

```yaml
availability:
  slot_granularity: 15 # minutes; slots snap to this boundary (default 15)
  minimum_notice: 120 # minutes of lead time required (default 120)
  maximum_lookahead: 60 # days bookable into the future (default 60)
  buffer_before: 0 # minutes padded before a meeting (default 0)
  buffer_after: 0 # minutes padded after a meeting (default 0)
  max_appointments_per_day: null # cap on meetings per day; null = unlimited (default null)
  default: # required: weekly working hours
    monday: ['09:00-17:00']
    tuesday: ['09:00-17:00']
    wednesday: ['09:00-17:00']
    thursday: ['09:00-17:00']
    friday: ['09:00-13:00', '14:00-17:00'] # multiple blocks allowed
    # days omitted = no availability
```

## `event_types`

The meetings people can book. `id`, `name`, `duration`, `slug`, `appointment_flow`, and
`destination_calendar` are required; everything else is optional.

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
    destination_calendar: 'work' # where the booking is written
    image_url: '/public/chat.png'
    location:
      mode: 'fixed'
      fixed: 'https://meet.google.com/abc-defg-hij'
    # any availability knob may be overridden here; omit to inherit the global value:
    slot_granularity: 30
    minimum_notice: 240
    maximum_lookahead: 30
    buffer_before: 5
    buffer_after: 5
    max_appointments_per_day: 4
```

### Location modes

```yaml
location: { mode: 'fixed', fixed: 'https://…' } # a static URL, address, or phone number
location: { mode: 'choice', choices: ['Zoom', 'Phone'] } # guest picks from a list
location: { mode: 'guest_proposes' } # guest enters a location when booking
```

## `database`

On-disk SQLite paths. Relative paths resolve against this config file's directory, so the
web and worker (loading the same `config.yaml`) open the same files.

```yaml
database:
  app: './data/when.sqlite' # appointments, OAuth tokens (default)
  queue: './data/openworkflow.sqlite' # background job queue (default)
```

## `url`

Public URLs the app builds links from.

```yaml
url:
  app: 'https://book.example.com' # public base URL (with scheme); used in emails + calendar events
  internal:
    'http://when-app:3000' # base URL the worker uses to reach the app on the internal
    # network, to fetch relative branding images for emails. Defaults to ${WHEN_URL_INTERNAL};
    # empty falls back to `app`.
```
