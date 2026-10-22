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
- `withWriteTransaction(db, write)` — reserve SQLite write access before a short
  read-modify-write operation. The callback gets a leased Kysely connection, not a
  `Transaction`. Use only that connection and await all queries before returning;
  do not nest transactions, close or retain it. Returning commits; throwing rolls
  back. Lock acquisition can still time out.
- `findAppointment(db, id)` / `getAppointment(db, id)` — read an appointment by ID.
  `findAppointment` returns `undefined` when missing; `getAppointment` requires a row
  and rejects with Kysely's `NoResultError` when missing.
- `recordVideoChatGenerationRequest(db, appointmentId)` — store standing `generate`
  intent and return its calendar revision. Repeating it preserves the entire row;
  changing it increments only the calendar revision and update time, not ICS or history.
  Call inside the write transaction that checked eligibility.
- `lastCalendarRefreshAt(status)` — proven mirror-refresh timestamp, or `null` when
  the latest observation cannot establish refresh freshness. Shared by worker and web.
- `recordCalendarEventReference(db, appointmentId, reference)` — record which
  calendar event belongs to an appointment, filling only compatible missing IDs.
  Recording a new reference invalidates sync evidence; repeating it does nothing.
- `markSynced(db, appointmentId, revision, reference)` — record sync evidence only
  while the revision and both reference IDs still match on a non-purged row. The
  required reference permits null IDs, compared null-safely.
- `recordCalendarEventDeletion(db, appointmentId, revision, reference)` — atomically
  clear both IDs and record sync evidence only for a matching revision and complete
  reference on a non-purged row. Records a receipt after provider deletion; does not
  contact the provider. Replaying after the IDs are cleared is a no-op.
- `listActiveAppointmentsForCalendarEvent(db, reference)` — return the pending and
  confirmed appointments referencing that event. This reads local rows, not the provider.
- `parseNotificationStatus(raw)` — parse the `appointments.notification_status`
  JSON column.
- Types: `Database`, `Appointment`, `NewAppointment`, `AppointmentUpdate`,
  `AppointmentStatus`, `VideoChatRequest`, `NotificationStatus`, `NotificationOutcome`, …

A `CalendarEventReference` contains `{ calendarId, eventId }`: the configured
calendar and the provider's event ID. The query returns the appointments themselves,
so callers can distinguish the current appointment from others using the event.

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
