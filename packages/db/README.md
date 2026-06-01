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
- `parseNotificationStatus(raw)` — parse the `appointments.notification_status`
  JSON column.
- Types: `Database`, `Appointment`, `NewAppointment`, `AppointmentUpdate`,
  `AppointmentStatus`, `NotificationStatus`, `NotificationOutcome`, …

## Scripts

- `pnpm build` — typecheck (`tsc --noEmit`).
- `pnpm test` / `pnpm test:coverage` / `pnpm lint`.
