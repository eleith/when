# @when/jobs

Shared workflow contracts for the `when` workspace, built on
[OpenWorkflow](https://openworkflow.dev) `0.11.0` over `node:sqlite`.

The producer (`@when/web`, or `@when/cli` for service probes) enqueues work from a
shared spec; `@when/worker` registers the implementation. Web never imports worker
implementations. Initializing a producer client does not start a worker or register
recurring schedules.

## API

- `reconcileAppointment` — coordinate appointment calendar/video updates and email.
- `purgeAppointment` — clean up purged appointment chains.
- `syncCalendars` — request the worker's calendar repair scan.
- `testEmail`, `testProvider`, `listProviderCalendars`, `testCalendar`,
  `generateVideoChat` — on-demand worker operations.
- `initOpenWorkflow({ dbPath, logger? })` — open and migrate the queue database and
  initialize the process-wide client. The first call wins, including its logger.
- `getOpenWorkflow()` — return that client; throws before initialization or after
  closing.
- `closeOpenWorkflow()` — idempotently close the queue connection, **after stopping
  its worker**. Closing an initialized client is terminal for that process. Calling
  this before initialization is a no-op.
- `getWorkflowRun(db, id)`, `getStepAttempts(db, id)` — read queue history through a
  caller-owned `DatabaseSync` connection.

Specs and their input/output types live in `src/specs.ts`. The `./specs` entrypoint
exports contracts without the process-wide client helpers.

Queue migrations run on connection, including producer connections. Existing step
results survive the engine upgrade, but that does not make a changed application
workflow graph safe to replay: drain old appointment work before deploying changed
handlers. Back up both SQLite databases consistently before an engine upgrade.

## Scripts

- `build` — typecheck and compile to `dist/`.
- `check` — typecheck without emitting.
- `test` / `test:coverage` — unit and real-engine integration tests.
- `lint` — Prettier and ESLint.

Tests use temporary queues, never a personal deployment database.
