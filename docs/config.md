# Configuration Guide

The `config.yaml` file is the heart of "When". It drives authentication, styling, availability, and routing without needing a complex admin UI or database state for these settings.

This guide explains the major sections of the configuration file. You can also view the raw JSON schema at `/schema/config.json` when the app is running.

## Environment Variable Interpolation

Any string value in `config.yaml` may reference `${ENV_VAR}`. The substitution happens before schema validation, so secrets stay in your environment rather than on disk.

```yaml
auth:
  oidc:
    client_secret: '${OIDC_CLIENT_SECRET}'
```

## User & Branding

Defines the owner of the schedule and the visual appearance of the booking page.

```yaml
user:
  name: 'Your Name'
  email: 'you@example.com'
  timezone: 'America/New_York' # IANA timezone identifier
  branding:
    page_title: 'Schedule a time with me'
    description: 'A little bit about me.'
    primary_color: '#ff5500' # Can also be an object with `light` and `dark`. A muted tonal scale is derived from it.
    logo_url: '/public/logo.png'
    avatar_url: '/public/my-avatar.jpg'
    favicon_url: '/public/favicon.ico'
```

To use custom assets, place them in the `./data/public/` directory, which is served statically under the `/public/` path.

## Authentication

The `auth` block must declare exactly one strategy for the `/admin` interface.

**Credentials Auth:** Local username/password.

```yaml
auth:
  credentials:
    username: 'admin'
    password_hash: '${ADMIN_PASSWORD_HASH}' # generate with `bun run hash-password`
```

**OIDC Auth:** Single Sign-On via an external provider.

```yaml
auth:
  oidc:
    issuer: 'https://auth.example.com'
    client_id: 'when'
    client_secret: '${OIDC_CLIENT_SECRET}'
```

## Calendars

You can integrate multiple external calendars to use as conflict sources (busy times) or destinations (where bookings are saved).

```yaml
calendars:
  - id: 'work'
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
```

_Note: For Google Calendar, use the `bun run setup-google` CLI tool to generate this block automatically._

## Availability

Defines your global working hours and scheduling rules.

```yaml
availability:
  slot_granularity: 15 # Slots snap to 15-minute boundaries
  minimum_notice: 120 # Require at least 2 hours notice
  maximum_lookahead: 60 # Allow booking up to 60 days in advance
  buffer_before: 0 # Minutes to pad before a meeting
  buffer_after: 0 # Minutes to pad after a meeting
  max_bookings_per_day: null # Limit total meetings per day
  default:
    monday: ['09:00-17:00']
    tuesday: ['09:00-17:00']
    wednesday: ['09:00-17:00']
    thursday: ['09:00-17:00']
    friday: ['09:00-13:00', '14:00-17:00'] # Supports multiple blocks
    # saturday, sunday omitted = no availability
```

## Event Types

The specific meetings people can book. Each event type can override global availability knobs.

```yaml
event_types:
  - id: 'chat'
    name: '30-minute chat'
    duration: 30
    slug: 'chat'
    visibility: 'public' # or 'private' to hide from the homepage
    booking_flow: 'auto' # or 'requires_confirmation'
    conflict_calendars: ['work', 'personal']
    destination_calendar: 'work'
    location:
      mode: 'fixed'
      fixed: 'https://meet.google.com/abc-defg-hij'
```

### Location Modes

- `fixed`: A static string (URL, phone number, address).
- `choice`: Provide an array of `choices` for the user to select from.
- `guest_proposes`: Ask the guest to input the location during booking.

## Email (SMTP)

If any event type uses `booking_flow: requires_confirmation`, you must provide SMTP credentials to receive approval emails and send confirmations.

```yaml
smtp:
  host: 'smtp.example.com'
  port: 587
  user: '${SMTP_USER}'
  pass: '${SMTP_PASS}'
```
