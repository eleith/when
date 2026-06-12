# @when/calendar

External-calendar I/O for the `when` workspace: provider adapters (Google,
CalDAV), recurrence expansion, busy-time fetching, appointment push/delete, and
local helpers like ICS generation.

The **provider-reaching logic** — the adapters and every network call to an
external calendar (busy-time fetch, appointment push/update/delete) — is meant to
run **only in the worker**. The worker is the only part of `when` that talks to
external calendars: it fetches busy times into a local mirror and pushes
appointments to the organizer's calendar. Web reads the already-expanded mirror
from `@when/db` and makes no provider call.

Web does import this package, but only the local, network-free pieces — `buildIcs`
(the `.ics` download endpoint) and `setLogger` (logging wiring). Tree-shaking
keeps the adapter/provider code out of the web bundle because web never
references it.

## Scripts

- `pnpm build` — typecheck (`tsc -p tsconfig.json`) then emit `dist/`.
- `pnpm test` / `pnpm test:coverage` / `pnpm lint`.
