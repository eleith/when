# Architecture

One booking app. Two processes. Shared files.

This is the map. The code has the street names.

## The pieces

Node 26, strict TypeScript and pnpm workspaces. SvelteKit serves web;
`node:sqlite` and Kysely handle data. OpenWorkflow runs background jobs.

| Path                  | Job                                           |
| --------------------- | --------------------------------------------- |
| `apps/web`            | Booking, admin and HTTP routes.               |
| `apps/worker`         | Calendar I/O, video links and email.          |
| `apps/cli`            | Config validation and operator commands.      |
| `packages/config`     | TypeBox schema, YAML loading and validation.  |
| `packages/db`         | App database, queries and migrations.         |
| `packages/jobs`       | Workflow contracts and queue client.          |
| `packages/calendar`   | Google/CalDAV adapters and local ICS helpers. |
| `packages/video-chat` | Google Meet and Nextcloud Talk adapters.      |

## A booking

```text
request → web: validate → save appointment → enqueue job → respond
                                               ↓
                       worker: calendar / video / email → record outcome
```

Web and worker share `when.yaml`, `when.sqlite` and `openworkflow.sqlite`.
Web imports job contracts, not worker implementations. Producers do not start a
worker or register schedules.

Booking reads a local busy-time mirror. Calendar providers expand recurrence;
CalDAV must support `CALDAV:expand`. Failed imports keep the old mirror, which is
not proof it is current. Calendar publishing writes content; video adapters handle
conferencing. Those network calls stay in the worker.

## Background work

The worker has one execution slot. Active slow calls block other jobs; native
retry delays park and release the slot. Saved steps avoid repeating checkpointed
successes, but a crash before checkpointing can duplicate a remote effect.
**At-least-once, not exactly-once.**

Enqueue keys deduplicate for 24 hours, including terminal runs. They are not retry
commands. Worker stop is not queue draining. See
[updates](deployment.md#updates) before deploying
changed workflow graphs.

## Time

Use native `Temporal` on the server and `temporal-polyfill/fns/*` in the browser.
Inject a clock into domain logic.

Displayed times follow the context's stored zone where applicable, then the `tz`
cookie, then the browser on first visit. Until the zone is known, show blank space
or a skeleton, not guessed times. `preferredTimezone.svelte.ts` owns the preference.

Slot links carry an absolute instant; day links carry a date in the viewer's zone.
There is no `tz` query parameter. Duration links must name an allowed choice;
otherwise use the configured default or the current booking's reschedule length.

## Styling and theming (web)

Scoped CSS and Bits UI. Use `theme.css` tokens for colors, dimensions,
type, radii, shadows and transitions; no hardcoded colors or pixel dimensions.
Components use the shared light/dark palette, not local dark-mode patches.

Keep component copy in markup. Script is for behavior, not identifier-to-sentence
mappers. A data-derived value for genuinely repeated copy is fine.

For development, see [development](development.md). For running it and backing it
up, see [deployment](deployment.md).
