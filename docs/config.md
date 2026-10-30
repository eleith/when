# Configuration

One `when.yaml` for the web app and worker. Auth, availability, calendars, email,
and what guests can book. No settings scavenger hunt.

Copy the [example](when.example.yaml) to `config/when.yaml` and edit it. It
documents every field; this page explains the rules. The running app serves its
editor schema at `/schema.json`:

```yaml
# yaml-language-server: $schema=http://localhost:3000/schema.json
```

Use your app's address if different. In a checkout, the generated schema also
lives at `packages/config/src/config.schema.json`; the source of truth is the
[TypeBox schema](../packages/config/src/schema.ts).

## File shape

| Key          | Required? | Purpose / default                                                                                       |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------- |
| `auth`       | Yes       | One admin sign-in strategy.                                                                             |
| `user`       | Yes       | Owner details and appearance.                                                                           |
| `smtp`       | Yes       | Outgoing appointment email.                                                                             |
| `providers`  | No        | Named services and their calendars; defaults to `{}`. Meetings must still reference declared calendars. |
| `schedules`  | Yes       | At least one named availability schedule.                                                               |
| `meetings`   | Yes       | At least one bookable meeting.                                                                          |
| `version`    | No        | Config format version, not the app release. Defaults to `1`; only `1` is accepted.                      |
| `database`   | No        | SQLite paths.                                                                                           |
| `url`        | No        | Public and internal service URLs.                                                                       |
| `prometheus` | No        | Metrics; off by default.                                                                                |

`providers`, `schedules`, and `meetings` are **maps, not lists**. Their keys are
their names; a meeting's key is also its URL slug. Use lowercase letters, digits,
and hyphens, starting with a letter or digit. The same rule applies to calendar
keys.

There is no top-level `calendars`, no provider or schedule `name`, and no meeting
`name` or `slug` field. Calendars belong inside their provider:

```yaml
providers:
  cloud:
    type: caldav
    url: 'https://cloud.example.com/remote.php/dav/'
    username: jane
    password: '${WHEN_CALDAV_PASSWORD}'
    calendars:
      work:
        href: 'calendars/jane/work/'
```

Unknown options are rejected. References to schedules, calendars, providers, and
form fields are checked at load time.

## Environment variables

Any string value can contain `${ENV_VAR}`. Values are substituted before runtime
validation, including in defaults. Keep secrets in the environment, not in
committed YAML.

- `${VAR}` fails loading if the variable is unset.
- `${VAR:-fallback}` uses the fallback if the variable is unset, not if it is empty.
- `$$` produces a literal `$`.

For example: `password: '${WHEN_SMTP_PASSWORD}'`. Deployment variables such as
`CONFIG_PATH`, `AUTH_SECRET`, and `ORIGIN` are covered in
[deployment](deployment.md#environment-variables).

## `auth`

Choose **exactly one** strategy for `/admin`.

```yaml
auth:
  credentials:
    username: admin
    # password defaults to ${WHEN_ADMIN_PASSWORD}
```

Or replace it with OIDC:

```yaml
auth:
  oidc:
    issuer: 'https://auth.example.com'
    client_id: when
    client_secret: '${WHEN_OIDC_CLIENT_SECRET}'
    # name: 'Single Sign-On' # default display name
```

`credentials.username` is required; `password` must be non-empty and defaults to
`${WHEN_ADMIN_PASSWORD}`. OIDC requires `issuer`, `client_id`, and `client_secret`;
`name` defaults to `Single Sign-On`.

Both strategies work in production. Choose based on who can reach sign-in:

- **Credentials:** suitable on a LAN, VPN, or behind an authenticating proxy.
  The app has **no password-attempt rate limiting or lockout** and warns about
  this at startup in production.
- **OIDC:** recommended for an internet-facing deployment. Throttling, lockout,
  password policy, and MFA belong to your identity provider.

If you expose credentials sign-in publicly, enforce rate limiting at the reverse
proxy.

## `user`

| Field        | Default      | Meaning                                                                |
| ------------ | ------------ | ---------------------------------------------------------------------- |
| `name`       | Required     | Owner's display name.                                                  |
| `email`      | Required     | Owner's valid email address.                                           |
| `timezone`   | `${TZ:-UTC}` | IANA zone, such as `America/New_York`. Schedule windows use this zone. |
| `appearance` | `{}`         | Optional overrides below.                                              |

### Appearance

Every field under `user.appearance` is optional.

| Field                    | Default                                             |
| ------------------------ | --------------------------------------------------- |
| `title`                  | `if not now, when?`                                 |
| `description`            | `find some time and we can meet`                    |
| `app_icon_path`          | `/assets/images/app-icon.svg`                       |
| `avatar_path`            | `/assets/images/avatar.svg`                         |
| `favicon_path`           | `/assets/images/favicon.svg`                        |
| `opengraph_path`         | `/assets/images/opengraph.png`                      |
| `font_name`              | `Noto Sans`                                         |
| `font_path`              | Unset; custom woff2 file registered as `font_name`. |
| `primary_light_color`    | `#166534`                                           |
| `primary_dark_color`     | `#34d399`                                           |
| `background_light_color` | `#f5f5f5`                                           |
| `background_dark_color`  | `#0a0a0a`                                           |
| `text_light_color`       | `#171717`                                           |
| `text_dark_color`        | `#ededed`                                           |

The default icon and favicon are bundled calendar marks. The default avatar is
generated from `user.name`; the default share card uses the appearance settings.
Bundled font families are Noto Sans, Lato, Outfit, and Inter.

All `*_path` values must be root-relative paths served by this app. Remote URLs
are rejected. Put custom files in `./public/`, alongside `config/` and `data/`,
and reference them as `/public/logo.png`. `WHEN_PUBLIC_DIR` overrides that directory.

Colors accept three- or six-digit hex values. Each primary color generates a
muted tonal scale for its mode; background and text colors override the surfaces
and text.

## `smtp`

Required. The worker uses this server for appointment emails.

| Field      | Default                    | Meaning                                       |
| ---------- | -------------------------- | --------------------------------------------- |
| `host`     | Required                   | SMTP hostname.                                |
| `port`     | `587`                      | Integer from 1–65535.                         |
| `username` | Required                   | SMTP username.                                |
| `password` | Required                   | SMTP password; use an environment reference.  |
| `from`     | `noreply@<url.app domain>` | Sender address your server is allowed to use. |

`from` is also the organizer on guest-facing calendar invites, keeping the host's
own address out of those fields. The sender display name is always `user.name`.

## `providers`

Named services, each containing a `calendars` map. See the
[example](when.example.yaml) for complete provider blocks.

| `type`      | Required fields               | Optional fields                                             |
| ----------- | ----------------------------- | ----------------------------------------------------------- |
| `google`    | `client_id`, `client_secret`  | `refresh_token` (default `''`), `calendars` (default `{}`). |
| `caldav`    | `url`, `username`, `password` | `calendars` (default `{}`).                                 |
| `nextcloud` | `url`, `username`, `password` | `calendars` (default `{}`). Also supports Talk video links. |

For CalDAV, `url` is the DAV endpoint. For Nextcloud, it is the instance base URL.

### Calendars

Calendar keys must be **unique across all providers**: meetings reference them by
name alone. They supply busy times, receive appointments, or both.

| Provider           | Calendar field               | Meaning                                                     |
| ------------------ | ---------------------------- | ----------------------------------------------------------- |
| Google             | `id` (required)              | Google calendar ID, such as `primary`.                      |
| CalDAV / Nextcloud | `href` (required)            | Path joined to the provider's `url`, or a full HTTP(S) URL. |
| All                | `sync.refresh_every_minutes` | Busy-time refresh interval; integer ≥ 1, default `10`.      |

A calendar needs no `type` or `provider` field; its parent supplies both.

### Google connection

An empty or omitted `refresh_token` means not connected. The config can load,
but the provider cannot reach Google until you connect it.

Connect from `/admin`. Google issues the token through browser consent; the admin
UI shows it once for you to save in an environment variable and reference in YAML.
After saving it, [recreate the containers](deployment.md#environment-variables).

## `schedules`

Each named schedule has a `weekly` list. Omit `weekly` to use Monday–Friday,
09:00–17:00. For example, `standard: {}` is a complete schedule.

Each rule needs `days`, `from`, and `to`:

```yaml
schedules:
  standard:
    weekly:
      - days: [mon, tue, wed, thu, fri]
        from: '09:00'
        to: '12:00'
      - days: [mon, tue, wed, thu, fri]
        from: '13:00'
        to: '17:00'
```

- Days are `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`.
- Times are 24-hour `HH:MM` in `user.timezone`; `from` must be earlier than `to`.
- Availability is the union of all rules. Repeat days for split windows.
- Days absent from every rule are unavailable. An explicit `weekly` list cannot be empty.

## `meetings`

The key is the booking URL slug: `chat` gives `/schedule/chat`.

```yaml
meetings:
  chat:
    title: 'A quick chat'
    schedule: standard
    booking_calendar: work
    duration_minutes: 30
    additional_duration_minutes: [15, 60]
```

### Booking options

| Field                         | Default  | Meaning                                                                                  |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `title`                       | Required | Text guests see.                                                                         |
| `schedule`                    | Required | Declared schedule name.                                                                  |
| `booking_calendar`            | Required | Declared calendar for confirmed bookings; always checked for conflicts.                  |
| `duration_minutes`            | `30`     | Default guest-selected length; positive integer.                                         |
| `additional_duration_minutes` | `[]`     | Other positive integer lengths guests may choose.                                        |
| `description`                 | Unset    | Brief description.                                                                       |
| `visibility`                  | `public` | `unlisted` hides it from the homepage, **not** from anyone with its link.                |
| `require_approval`            | `true`   | Host approves bookings; `false` confirms instantly.                                      |
| `additional_busy_calendars`   | `[]`     | Other calendar names to check for conflicts.                                             |
| `show_slots`                  | `false`  | `true` draws slot buttons; `false` uses a bare drag timeline snapping to the same slots. |
| `location`                    | Unset    | Static address, phone number, or link.                                                   |
| `note`                        | Unset    | Host note shown to guests after booking.                                                 |
| `video_chat`                  | Unset    | Dynamic video link settings below.                                                       |
| `form_fields`                 | Unset    | Custom booking form below.                                                               |
| `start_times_every_minutes`   | `30`     | Positive integer slot step, independent of offered durations.                            |
| `notice_minutes`              | `120`    | Minimum lead time; integer ≥ 0.                                                          |
| `booking_window_days`         | `60`     | Days into the future open for booking; integer ≥ 1.                                      |
| `padding_before_minutes`      | `0`      | Padding before appointments; integer ≥ 0.                                                |
| `padding_after_minutes`       | `0`      | Padding after appointments; integer ≥ 0.                                                 |
| `daily_booking_limit`         | `null`   | Positive integer daily cap; `null` means unlimited.                                      |

Duration choices are deduplicated and sorted numerically. New bookings start with
`duration_minutes`, rescheduling starts with the booked length, and a valid
`duration` link overrides either. The first choice is not necessarily the default.
Hosts also get preset lengths; guests do not gain those choices except to retain
a booked length. The slot step does not change with the selected duration.
A step shorter than a duration produces overlapping candidate slots, visible
when `show_slots` is enabled.

### Custom forms

Without `form_fields`, the form asks for a required guest name, required guest
email, and optional notes. Setting `form_fields` **replaces** that default form.

Supply 1–10 fields, with unique `name` values. Each needs `name`, `type`, and
`label`; `required` defaults to `false`, and `show_when` is optional.

| Type                                   | Rules                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `guest_name`                           | Exactly one, with `required: true`.                                         |
| `guest_email`                          | At most one; optional in a custom form.                                     |
| `event_location`                       | At most one. With `choices`, guests pick a location; without, they type it. |
| `choice`                               | Requires a non-empty `choices` list of non-empty strings, in display order. |
| `text`, `number`, `phone`, `paragraph` | General questions; `choices` is not accepted.                               |

This is a `form_fields` block inside a meeting:

```yaml
form_fields:
  - name: name
    type: guest_name
    label: 'Your name'
    required: true
  - name: contact
    type: choice
    label: 'How should we reach you?'
    choices: [email, phone]
    required: true
  - name: email
    type: guest_email
    label: 'Your email'
    required: true
    show_when:
      - field: contact
        equals: email
  - name: phone
    type: phone
    label: 'Your phone number'
    required: true
    show_when:
      - field: contact
        equals: phone
```

Every `show_when` condition must hold (AND). Conditions reference **earlier** fields:

- `equals: phone` matches one value.
- `equals: [phone, email]` accepts any listed value.
- Omitting `equals` tests whether the field is filled.

For a `choice` controller, matched values must exist in its `choices`. Hidden
fields are never required, and their answers are not recorded.

### Video links

`video_chat.provider` names a declared `google` or `nextcloud` provider, not a
calendar. Google Meet also requires a Google booking calendar. Generic CalDAV
providers do not generate video links.

Choose one attachment rule under `video_chat.attach`:

| Rule                     | Behavior                                                       |
| ------------------------ | -------------------------------------------------------------- |
| Omitted, or `auto: true` | Generate a link automatically on booking.                      |
| `auto: false`            | Host generates the link on demand.                             |
| `when: [...]`            | Generate automatically when every form-answer condition holds. |

Use `auto` **or** `when`, not both. `when` is a non-empty list using the same
`field` / `equals` conditions as forms, referencing fields in this meeting.
For example, inside a meeting with a `contact` field:

```yaml
video_chat:
  provider: nextcloud-service
  attach:
    when:
      - field: contact
        equals: video
```

A `choice` field must include the matched value (`video` here). Links are generated
per appointment as Google Meet URLs or Nextcloud Talk rooms.

## `database`

| Field   | Default                      | Contents                                           |
| ------- | ---------------------------- | -------------------------------------------------- |
| `app`   | `./data/when.sqlite`         | Appointments, mirrored busy times, service status. |
| `queue` | `./data/openworkflow.sqlite` | Background job queue.                              |

Relative paths resolve against the config directory's **parent**, not the shell's
working directory. With `config/when.yaml`, `config/` and `data/` are siblings.
Web and worker must load the same config and share these files.

`WHEN_DATABASE_PATH` and `WHEN_QUEUE_DB_PATH` override the respective YAML paths.
Treat both databases and their backups as sensitive; see
[persistence](deployment.md#persistence).

## `url`

| Field      | Default                            | Used for                                                                              |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| `app`      | `${ORIGIN:-http://localhost:5173}` | Public base URL, including scheme; links in emails and calendar events.               |
| `internal` | `${WHEN_URL_INTERNAL:-}`           | Worker → web, including branding images embedded in email. Empty falls back to `app`. |
| `worker`   | `http://when-worker:9000`          | Web → worker telemetry and metrics.                                                   |

Usually, set `ORIGIN` and leave `url.app` alone. It supplies When's public URL
for authentication and generated links; an explicit `url.app` takes precedence.
SvelteKit 3's native adapter ignores `ORIGIN` and derives its request origin from
trusted proxy headers and Host instead. These must match the configured public
URL; see the [proxy requirements](deployment.md#reverse-proxy).

## `prometheus`

| Field     | Default                   | Meaning                                   |
| --------- | ------------------------- | ----------------------------------------- |
| `enabled` | `false`                   | Enable metrics collection and `/metrics`. |
| `token`   | `${WHEN_METRICS_TOKEN:-}` | Bearer token required for scraping.       |

When disabled, `/metrics` returns 404. When enabled without a non-empty token,
it returns 500, not public metrics. Scrape with `Authorization: Bearer <token>`.
See [operating endpoints](deployment.md#inspect-logs).
