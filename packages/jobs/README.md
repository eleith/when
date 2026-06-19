# @when/jobs

Shared job/workflow contract for the `when` workspace, built on
[openworkflow](https://openworkflow.dev) (durable execution on `node:sqlite`,
zero native addons).

This package is the single source of truth for **what** jobs exist and their
input/output shapes. The producer (`@when/web`) triggers runs from a spec; the
worker (`@when/worker`) provides the implementation. Keeping the spec here lets
both sides share types and resolve the workflow by name without web depending on
the worker.

## API

- `sendAppointmentEmail` — the `send-appointment-email` workflow spec.
- Types: `AppointmentEmailKind`, `SendAppointmentEmailInput`, `SendAppointmentEmailResult`.
- `createBackend(path, opts?)` / `createClient(path, opts?)` — connect a
  `node:sqlite` openworkflow backend / build an `OpenWorkflow` client over it.

## Scripts

- `pnpm build` — typecheck (`tsc --noEmit`).
- `pnpm test` / `pnpm test:coverage` / `pnpm lint`.
