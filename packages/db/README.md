# @when/db

Shared SQLite data layer for the `when` workspace.

Wraps Node's built-in `node:sqlite` behind a small Kysely dialect (no native
addons), and owns the schema types, migrations, and migration runner. Consumed
by `@when/web` and `@when/worker`, which both open the same `when.sqlite`.

## API

- `openDb(path)` — open (and, for file paths, create the parent dir of) a
  `node:sqlite` database as a typed `Kysely<Database>`.
- `runMigrations(db)` — apply pending migrations; returns the applied names (the
  caller logs — the package stays logger-agnostic).
- `migrations` — the ordered migration set.
- `lastCalendarRefreshAt(status)` — proven mirror-refresh timestamp, or `null` when
  the latest observation cannot establish refresh freshness. Shared by worker and web.
- `parseNotificationStatus(raw)` — parse the `appointments.notification_status`
  JSON column.
- Types: `Database`, `Appointment`, `NewAppointment`, `AppointmentUpdate`,
  `AppointmentStatus`, `VideoChatRequest`, `NotificationStatus`, `NotificationOutcome`, …

`video_chat_request` is a standing instruction, not job progress:

- `NULL` follows configured attachment rules.
- `generate` asks for a generated link when one is missing, regardless of attachment rules.
- `suppress` prevents generation without removing a selected URL.

The selected URL remains in `video_chat`. Existing and new appointments default to
`NULL`. Migration does not interpret activity history or change existing URLs, ICS
sequences or calendar revisions; historical Remove choices are not carried forward.

## Scripts

- `pnpm build` — typecheck (`tsc --noEmit`).
- `pnpm test` / `pnpm test:coverage` / `pnpm lint`.
