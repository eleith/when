# @when/calendar

External-calendar I/O for the `when` workspace: provider adapters (Google,
CalDAV), provider-expanded busy-time fetching, appointment push/delete, and local
helpers like ICS generation.

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

## Busy-time contract

Both adapters return concrete occurrences with UTC start/end instants and a provider
identity for own-event exclusion: CalDAV UID or Google event ID.
Google uses `singleEvents=true`; CalDAV requests `CALDAV:expand` for the same bounded
window as its query filter ([RFC 4791 §9.6.5](https://www.rfc-editor.org/rfc/rfc4791.html#section-9.6.5)).
There is no local recurrence engine or fallback when a server ignores expansion.

CalDAV imports reject failed resources or calendar-data properties, malformed calendar
data, remaining recurrence rules/exclusions, and unresolved timezone references. The
expanded-data reader accepts VCALENDAR containing VEVENTs with optional nested VALARMs;
unrequested component types are rejected rather than interpreted as event properties.
The worker retains the previous busy mirror and records a refresh failure. A successful
import with no remaining busy intervals clears it. Cancelled and transparent occurrences are discarded. Multiple occurrences sharing a
UID remain distinct, while the common path excludes our own published UIDs and keeps
intervals overlapping the requested window without clipping their bounds.

Date-only and floating date-times retain the existing UTC interpretation. The REPORT
supplies a UTC `CALDAV:timezone` ([RFC 4791 §9.8](https://www.rfc-editor.org/rfc/rfc4791.html#section-9.8))
so server selection uses that same policy instead of the calendar's default timezone.
Explicit timezone-referenced date-times are still resolved by the server and returned
in UTC. Durations on concrete occurrences use elapsed UTC time, including 24-hour days;
no server-local Date arithmetic is used. Outgoing ICS generation and publishing are unchanged.

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
