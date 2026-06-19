# Philosophy

This document explains _what_ "When" is and _why_ it is built the way it is. The
tangible "how" lives in [`architecture.md`](architecture.md); read this first, because
it explains the constraints every design decision is measured against.

## What "When" is

A scheduling tool for **one** person — the individual self-hoster who wants an appointment
page on their own infrastructure. It is not, and will not become, a multi-tenant SaaS.

## Principles

- **One schedulable user.** There is exactly one owner. No teams, no org accounts, no
  per-tenant routing. This single assumption removes most of the complexity that
  scheduling products accumulate, and we spend that saved complexity budget on doing
  the single-user case well.
- **Radical simplicity.** Reject multi-tenancy, team routing, round-robin assignment,
  and enterprise workflow. Keep the surface area small enough to hold in your head and
  to test exhaustively.
- **Configuration over UI.** The owner's setup lives in `config.yaml`, not in a
  database edited through admin screens. The app reads config; it does not manage it.
  This keeps state declarative, reviewable in version control, and free of migration
  churn for settings.
- **No "just-in-case" code.** Build only what the single-user scope needs today. Don't
  add abstract interfaces, plugin points, or routing layers for features that don't
  exist yet. The adapter seams that _do_ exist (calendars) earn their keep by removing
  conditionals we'd otherwise write today — not by anticipating hypothetical providers.
- **Explicit over implicit.** Avoid magic. Fail loudly with clear errors and logging.
  Prefer code that reads like what it does over clever indirection.

## Why some of the bigger decisions went the way they did

- **A worker process, separate from the web app.** Calendar I/O and email are slow and
can fail; running them inside a request would make appointment scheduling feel fragile and slow.
Instead the web app does the minimum on the request path (write the appointment, enqueue
  a job) and a background worker does the rest — sending emails, pushing to calendars,
  refreshing busy times — with durable retries. The request stays fast and the
  side-effects become observable and replayable.
- **State in `config.yaml` + SQLite, nothing else.** Settings are config; appointments are
  rows. There is no third place state can hide. SQLite (via Node's built-in
  `node:sqlite`) means zero external services to run and a single file to back up.
- **One JSON Schema as the source of truth for config.** Rather than hand-writing
  validators (e.g. Zod) _and_ types _and_ editor hints separately, we keep one
  canonical JSON Schema and generate the rest: strict TypeScript types, and a relaxed
  copy for editor autocomplete. Validation, types, and editor tooling can't drift
  because they share one origin. Required-but-defaulted fields stay strict in code (ajv
  fills the default at load) while the editor copy relaxes them so it doesn't nag.
- **A single brand hue.** Branding is one `primary_color`; the rest of the palette is a
  tonal scale derived from it. One knob to set, a coherent theme guaranteed, and no
  surface for a self-hoster to build an inconsistent look.

When a change tempts you to add a tenant boundary, a settings table, a second brand
color, or an abstraction for a provider you don't have — that's the signal to stop and
re-read this page.
