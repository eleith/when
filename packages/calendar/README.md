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

Calendar publishing writes appointment content only. Selected video URIs appear in
appointment descriptions (including non-HTTP URIs); publishing does not create,
copy, clear, or adopt conferences. Google updates use PATCH with an encoded event
ID; creates use POST. Neither sends `conferenceData` or applies video attach policy.

## Google event I/O

`getGoogleEvent` reads a stored event. `patchGoogleEvent` sends supplied fields and
query parameters to that event. Both reuse Google authentication and return
unvalidated response data. PATCH 204 returns `undefined`, distinct from JSON `null`.

The Google adapter in `@when/video-chat` accepts event operations backed by these
functions. Conference payloads and interpretation belong to that adapter, not the
calendar transport. Neither package owns worker retries or appointment writes.

## Scripts

- `pnpm build` — typecheck (`tsc -p tsconfig.json`) then emit `dist/`.
- `pnpm test` / `pnpm test:coverage` / `pnpm lint`.
