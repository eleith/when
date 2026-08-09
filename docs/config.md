# Configuration

`when.yaml` is the heart of "When" — it drives authentication, branding,
availability, calendars, email, and the meetings people can book, without an admin
database for settings. This is the complete reference; the canonical source of truth is
defined in [schema.ts](file:///home/eleith/dev/when/packages/config/src/schema.ts) (TypeBox), which generates `config.schema.json` for editors to point at.

Point your editor at that schema for inline autocomplete and validation:

```yaml
# yaml-language-server: $schema=./config.schema.json
```

The required top-level keys are: `auth`, `user`, `smtp`, `providers`, `schedules`, `meetings`. Optional top-level keys include `version`, `database`, `url`, and `prometheus`.

`providers`, `schedules`, and `meetings` are **maps keyed by name, not lists**. The key _is_
the name — a provider has no `name:` field, a schedule has no `name:`, and a meeting has
neither `name:` nor `slug:` (its key is the slug, and `title:` holds the text guests see).
There is likewise **no top-level `calendars:`**: a calendar is declared inside the
`calendars:` map of the provider that serves it, which is what gives it its type and
credentials.

```yaml
# not this                          # this
providers:                          providers:
  - name: cloud                       cloud:
    type: caldav                        type: caldav
calendars:                              calendars:
  - name: work                            work:
    provider: cloud                         href: 'calendars/jane/work/'
```

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
    client_secret: '${WHEN_OIDC_CLIENT_SECRET}'
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
    client_secret: '${WHEN_OIDC_CLIENT_SECRET}'
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
    app_icon_path: '/public/logo.png'
    avatar_path: '/public/my-avatar.jpg'
    favicon_path: '/public/favicon.svg'
    opengraph_path: '/public/share-card.png'
    font_name: 'Outfit' # bundled: Noto Sans, Lato, Outfit, Inter
    font_path: '/public/my-font.woff2' # a woff2 registered as font_name, for a non-bundled family
    primary_light_color: '#166534' # brand hue, light mode
    primary_dark_color: '#34d399' # brand hue, dark mode
    background_light_color: '#f5f5f5'
    background_dark_color: '#0a0a0a'
    text_light_color: '#171717'
    text_dark_color: '#ededed'
```

`appearance` and all of its fields are optional; defaults are applied when omitted. `app_icon_path` and `favicon_path` default to a bundled spiral-calendar mark (`/assets/images/app-icon.svg`, `/assets/images/favicon.svg`), `avatar_path` defaults to `/assets/images/avatar.svg` — a placeholder avatar generated from `user.name` — and `opengraph_path` defaults to `/assets/images/opengraph.png`, a share card generated from the rest of the appearance. Every `*_path` here is a root-relative path to an asset this app serves; remote URLs are rejected. `primary_light_color` and `primary_dark_color` set the brand hue for light and dark modes, and a muted tonal scale is derived from each; the `background_*_color` and `text_*_color` fields likewise override the light/dark surface and text colors. To override any of them, place custom assets in `./public/` (a sibling of `config/` and `data/`, overridable with `WHEN_PUBLIC_DIR`) and reference them as `/public/...`.

## `smtp`

**Required.** The worker sends all appointment emails over this server; the appointment system
relies on it.

```yaml
smtp:
  host: 'smtp.example.com'
  port: 587 # defaults to 587
  username: 'you@example.com'
  password: '${WHEN_SMTP_PASSWORD}'
  from: 'bookings@example.com' # optional; defaults to noreply@<your url.app domain>
```

`from` is the address on every email and the organizer on guest-facing calendar invites, so
the host's own address is never exposed. It must be one your SMTP server may send from. The
display name always comes from `user.name`.

## `providers`

External services and the calendars they serve, each keyed by the name you refer to it
by. Three `type`s are supported: `google`, `caldav`, and `nextcloud`.

A calendar is declared inside the provider that serves it, so it needs no `provider`
reference and no `type` of its own — both are implied by where it sits. Calendars are
conflict sources (busy times) and/or appointment destinations.

```yaml
providers:
  my-google-service:
    type: 'google'
    client_id: '${WHEN_PROVIDER_GOOGLE_SERVICE_CLIENT_ID}'
    client_secret: '${WHEN_PROVIDER_GOOGLE_SERVICE_CLIENT_SECRET}'
    refresh_token: '${WHEN_PROVIDER_GOOGLE_SERVICE_REFRESH_TOKEN:-}' # from /admin; empty = not connected
    calendars:
      personal: # referenced by meetings
        id: 'primary' # the Google calendar ID
        sync:
          refresh_every_minutes: 10 # minutes between busy-time refreshes (default 10)
  my-caldav-service:
    type: 'caldav'
    url: 'https://cloud.example.com/remote.php/dav/'
    username: 'jane'
    password: '${WHEN_PROVIDER_CALDAV_SERVICE_PASSWORD}'
    calendars:
      work:
        href: 'calendars/jane/work/' # joined to the provider url
      shared:
        href: 'https://other.example.com/dav/shared/' # ...or a full URL of its own
  my-nextcloud-service:
    type: 'nextcloud'
    url: 'https://nextcloud.example.com/'
    username: 'jane'
    password: '${WHEN_PROVIDER_NEXTCLOUD_SERVICE_PASSWORD}'
    calendars: {}
```

**Calendar keys must be unique across every provider**, since meetings reference them by
name alone. A CalDAV or Nextcloud calendar names its location with `href`, which is either joined to
the provider's `url` or a full URL of its own. `sync.refresh_every_minutes` is optional
everywhere.

A Google provider's `refresh_token` is the one credential you cannot write from scratch:
Google only issues it through a browser consent round-trip. Connect the provider from
`/admin`, which shows the token once, then store it in an env var and reference it here
like any other secret. It is optional and defaults to empty — an empty token simply reads
as not connected, so a provider works up to the point of actually reaching Google. See
[deployment](deployment.md) for the full flow, including the container recreate that a new
env var needs.

## `schedules`

Weekly schedules defining availability slots, keyed by the name meetings refer to.
`weekly` is a list of rules, each naming the `days` it applies to and a `from`/`to` window (24-hour
`HH:MM`, in `user.timezone`). Availability is the union of all rules.

```yaml
schedules:
  standard: # the key is the name meetings reference
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

The meetings people can book. **The key is the URL slug** — `30-min-chat` is booked at
`/schedule/30-min-chat`. `title`, `schedule`, and `booking_calendar` are required — every
meeting names what it is, where it books, and when. `duration_minutes` (30),
`require_approval` (true), and `show_slots` (false) all default; everything else is optional.

```yaml
meetings:
  chat: # URL slug: /schedule/chat
    title: '30-minute chat'
    duration_minutes: 30 # the default length offered (default 30)
    additional_duration_minutes: [15, 60] # further lengths the guest may pick
    description: 'A quick intro call.'
    visibility: 'public' # 'public' (default) or 'unlisted' (kept off the homepage; the link still works)
    require_approval: true # true (default, host approves each booking) or false (instant)
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
  app: './data/when.sqlite' # appointments, busy times, service status (default)
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
  token: '${WHEN_METRICS_TOKEN:-}' # Bearer token for scraping metrics (default: ${WHEN_METRICS_TOKEN})
```
