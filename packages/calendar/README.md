# @when/calendar

External-calendar I/O for the `when` workspace: provider adapters (Google,
CalDAV), recurrence expansion, busy-time fetching, and appointment push/delete.

This package is **worker-only**. The worker is the only part of `when` that
talks to external calendars — it fetches busy times into a local mirror and
pushes appointments to the organizer's calendar. Web reads the already-expanded
mirror from `@when/db` and never imports this package or makes a provider call.

(During the calendar-to-worker migration, web temporarily still imports this
package for the read/push paths; that dependency is removed once the worker
owns refresh and publish.)

## Scripts

- `pnpm build` — typecheck (`tsc -p tsconfig.json`) then emit `dist/`.
- `pnpm test` / `pnpm test:coverage` / `pnpm lint`.
