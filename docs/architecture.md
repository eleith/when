# Architecture

How "When" is built. For _why_ it's built this way, see
[`philosophy.md`](philosophy.md).

## Stack

Node 26, TypeScript (`strict`), pnpm workspaces. SvelteKit (`@sveltejs/adapter-node`)
for the web app. SQLite through Node's built-in `node:sqlite` behind a small Kysely
dialect. [openworkflow](https://openworkflow.dev) for durable background jobs. Vitest
for tests, Prettier + ESLint for formatting/linting. Email templates render with Eta;
zoned time math uses Node's native `Temporal` on the server and `temporal-polyfill`'s
function-style entrypoints (`temporal-polyfill/fns/*`) in the browser; calendar iCal in
and out goes through `ts-ics`.

## Monorepo layout

A pnpm workspace (`apps/*`, `packages/*`). Tests are co-located as `*.test.ts` next to
the code they cover — there is no top-level `tests/` directory.

| Path                  | Role                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `apps/web`            | SvelteKit app: appointment page, admin UI, API routes. Also holds `e2e/` (Playwright).       |
| `apps/worker`         | Long-running background service: calendar sync + email delivery. See its README.             |
| `apps/cli`            | Operator CLI (`when-cli`): config validation, service/calendar testing, and email test.      |
| `packages/config`     | Canonical `when.yaml` schema, generated types, loader/validator. See its README.             |
| `packages/db`         | SQLite data layer: `node:sqlite` + Kysely dialect, schema types, migrations. See its README. |
| `packages/jobs`       | The job/workflow contract shared by web (producer) and worker (consumer). See its README.    |
| `packages/calendar`   | External-calendar I/O: provider adapters, busy-time fetch, push/delete, ICS. See its README. |
| `packages/video-chat` | Video conferencing I/O: provider adapters (Google Meet, Nextcloud Talk) and dynamic links.   |

Each package's `README.md` is the detailed reference for that package; this document is
the system-level overview that ties them together.

## Two-process model

The web app and the worker are separate processes that share **one `when.yaml`** and
**one data directory**. The web app stays on the request path only long enough to do the
durable, fast work — validate, write the appointment row, enqueue a job — and returns. The
worker does everything slow or failure-prone: sending emails, pushing to external
calendars, refreshing busy times. They communicate through the database, not over HTTP.

```
appointment request ─► web: write appointment row ─► enqueue job ─► respond
                                                      │
                          (shared SQLite + config)    ▼
                                              worker: drain job ─► send email / sync calendar
```

## Background jobs

Jobs run on openworkflow over `node:sqlite`. `packages/jobs` is the single source of
truth for **what** jobs exist and their input/output shapes
(`packages/jobs/src/specs.ts`): the web app triggers a run from a spec
(\`runWorkflow(sendAppointmentEmail, …)\`), and the worker provides the implementation. Both
sides share types and resolve a workflow by name, so web never imports worker code.

- **Durable steps.** Each side-effect (one SMTP send) is a memoized `step.run(...)` with
  its own retry policy, so a replay never re-sends something already sent.
- **Idempotency keys** dedupe enqueues within openworkflow's dedup window. Appointment emails
  key on `appointmentId:kind:ics_sequence` — `ics_sequence` bumps on every reschedule, so
  a repeat same-kind email isn't swallowed as a duplicate. Calendar sync uses a random
  key per call (each appointment change should trigger a scan).

## Calendar I/O (off the request path)

`packages/calendar` owns all provider-reaching logic — the Google and CalDAV adapters
and every network call to an external calendar. **This code runs only in the worker.**
The worker fetches busy times into a local mirror in the database and pushes
appointments to the organizer's destination calendar. The web app reads the
already-expanded busy mirror from `@when/db` and makes no provider call. Web does import
`@when/calendar`, but only the network-free pieces (`buildIcs` for the `.ics` download
endpoint, `setLogger`); tree-shaking keeps the adapter code out of the web bundle.

## Email pipeline

Lives in `apps/worker/src/email`. The flow separates assembly from rendering from
delivery:

- **Builders** (\`builders/\*.ts\`) are pure functions: from an appointment they produce
  `EmailMessage` values (an addressed `EmailContent` model + optional ICS attachment).
  They do no I/O and no rendering.
- **`renderMessage`** (`render.ts`) turns one `EmailMessage` into a send-ready envelope
  using Eta templates (`templates/email.html.eta`, `email.txt.eta`) and the shared
  `emailTheme` tokens (`theme.ts`). It is the single place the brand logo is attached.
- **`Mailer`** (`smtp.ts`) sends an envelope over SMTP. It's built once at boot from
  config and carried on the worker context (`services/context.ts`), so handlers depend on
  it explicitly rather than reaching for a global — the same injection style as the
  workflow `step`.

## Data layer

`packages/db` wraps `node:sqlite` behind a small Kysely dialect (no native addons) and
owns the schema types, migrations, and runner. Migrations run on boot and are idempotent.
Both web and worker open the same `when.sqlite`; the worker additionally owns the
openworkflow queue database.

## Configuration system

`packages/config` keeps the canonical config schema as JSON Schema
(`src/config.schema.json`) and generates everything else from it:

- **Strict TypeScript types** via `json2ts`, so defaulted fields are non-optional in code
  (ajv fills the default at load).
- **A relaxed editor schema** (`config.external.schema.json`) that drops defaulted fields
  from `required`, so an editor pointed at it via `# yaml-language-server: $schema=…`
  doesn't flag omitted-but-defaulted fields. Point a `when.yaml` at this relaxed copy,
  never the canonical one.

`${ENV_VAR}` references in any string are interpolated **before** validation, so secrets
stay in the environment, not on disk. Validation is **ajv** against the canonical schema
plus a cross-reference pass (`cross-refs.ts`) for things JSON Schema can't express (e.g.
an event type's `destination_calendar` must name a declared calendar). This project does
not use Zod — the JSON Schema is the one validator. The full `when.yaml` reference is
[`config.md`](config.md).

## Cross-cutting concerns

### Time

Never call `new Date()` or `Date.now()` inline in domain logic. Inject a `Clock` service
(`now()`) so tests can pin time. All zoned datetime math uses `@js-temporal/polyfill`
(a future Node upgrade will swap this for the native `Temporal` global).

**Viewer timezone.** Times shown to a person render in _their_ zone, resolved in this
precedence: (1) a context-specific stored zone — e.g. an appointment's \`attendee_timezone\`;
(2) the `tz` cookie — the viewer's preference, read server-side so SSR is correct and
flash-free; (3) first visit with no cookie — the client seeds it from the browser zone.
The cookie defaults to the browser zone and is replaced where a surface lets the user
choose (the scheduler). While the zone is still unknown (only the first visit, before the
cookie is set), render **blank space** where the time goes — never a guessed placeholder
time; a surface may substitute its own placeholder (e.g. a slot picker showing something).
The shared accessor is `$lib/preferredTimezone.svelte.ts` (`createPreferredTimezone` /
`getPreferredTimezone`).

**Deep links are zone-agnostic.** A slot is an absolute ISO instant (`?slot=…Z`) matched
directly against availability; a `date` (`YYYY-MM-DD`) day link opens in the viewer's zone.
There is no `tz` parameter — display always follows the viewer, so a link carries the
moment, not a zone.

### Security

- Credentials auth compares plain passwords resolved from environment variables/config.
- Secrets are injected via `${ENV_VAR}` interpolation in `when.yaml`, never committed.
- Secrets persisted to SQLite (OAuth refresh tokens) are encrypted at the column level
  with AES-256-GCM using the `ENCRYPTION_KEY` env var.
- Never log raw request bodies, session tokens, `cancel_token` values, or decrypted
  secrets.

### Styling and theming (web)

Vanilla CSS with Svelte's scoped `<style>` blocks. **No Tailwind.** Use [Bits UI](https://bits-ui.com)
for headless, accessible component primitives.

- **Theme variables only.** Every visual value — colors, spacing, font sizes, radii,
  shadows, transitions — must use the custom properties in
  `apps/web/src/lib/styles/theme.css`. Hardcoded hex/pixel values in component styles are
  forbidden. Colors are semantic (`var(--primary)`, `var(--text)`, `var(--surface)`,
  `var(--border)`); there is one brand hue (`--primary`) with a derived tonal scale —
  don't introduce a second.
- **Branding + dark mode.** `--primary` is injected at the root layout from the user's
  `when.yaml` appearance; the tonal scale derives from it. Dark mode is handled by media
  queries in `theme.css`, so components need no explicit dark-mode overrides.
- **Copy lives in the markup.** Per-component user-facing strings (titles, labels, button
  text) belong in the template via `{#if}` chains, not in a `<script>`-side mapper
  function. `<script>` is for behavior (formatting transforms, handlers, data-derived
  state), not identifier-to-string mapping. If a string repeats 3+ times in one component,
  a data-derived `$derived` is fine — a mapper function is not.

## Testing

Unit tests are co-located `*.test.ts` files run by Vitest. Domain logic stays testable by
injecting dependencies — the `Clock` for time, a fake `Mailer` for email, a fake workflow
`step` for jobs — rather than reaching for globals. End-to-end tests live in
`apps/web/e2e` and run against a real browser with Playwright.
