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
- `syncCalendars` — `{}` → `requested`, after the actual calendar repair scan finishes.
- `refreshCalendars` — `{}` → `refreshed`, after refresh and conflict checks.
- `expirePendingAppointments` — `{}` → `expired`, after idempotent expiry SQL.
  Completed maintenance passes can include recorded provider failures.
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

Queue migrations run on connection, including producer connections. Do not start a
new producer against the old deployment during cutover. Saved results do not make
changed application graphs safe to replay. Follow the
[grouped rollout runbook](../../docs/deployment.md#grouped-workflow-rollout): drain all
unfinished old work before deployment, then stop and back up both SQLite databases
consistently. Never automatically rerun terminal history. Reusing an enqueue key
can return an existing terminal run within the engine's 24-hour dedup window.

Prepared envelopes contain personal data and guest capability links; queue files and
backups are sensitive. Remote effects and logs can duplicate after a crash before
checkpointing, so neither durable steps nor enqueue keys provide exactly-once effects.

## Schedule management

Only native worker `start()` persists the declarations from registered implementations.
Startup awaits it, then enqueues refresh, expiry and sync independently with `{}` and
no run options. Their UTC schedules are `*/5 * * * *`, `0 * * * *`, and `*/10 * * * *`,
with IDs `when:refresh-calendars`, `when:expire-pending-appointments`, and
`when:sync-calendars`. Upserts preserve pause; startup runs do not depend on cron's pause
state. Cron is wall-clock aligned and catches up once per overdue schedule, not per
missed tick. No application timers or coalescers supplement it.

These are the installed `0.11.0` public APIs, not `when-cli` commands. Given an initialized
client connected to the intended queue, list every page:

```ts
const client = getOpenWorkflow();
let after: string | undefined;
do {
	const page = await client.schedules.list({ limit: 100, after });
	console.table(
		page.data.map(({ id, cron, timezone, nextRunAt }) => ({
			id,
			cron,
			timezone,
			nextRunAt
		}))
	);
	after = page.pagination.next ?? undefined;
} while (after);
```

Manage one schedule explicitly (the following are separate operator actions):

```ts
await client.schedules.pause('when:sync-calendars');
await client.schedules.resume('when:sync-calendars');
await client.schedules.delete('when:sync-calendars');
```

`nextRunAt === null` means paused; resume computes the next future occurrence. Pause
and delete do not cancel already queued runs or suppress independent startup runs.
Removing a declaration alone leaves its persisted schedule active. To retire a target,
stop the worker, delete its schedule through the public API, and remove the declaration
before restarting; otherwise native startup recreates it. Schedule-management connections
also migrate queues, so use the matching deployed version, not a new client for old-queue
read-only inspection.

## Scripts

- `build` — typecheck and compile to `dist/`.
- `check` — typecheck without emitting.
- `test` / `test:coverage` — unit and real-engine integration tests.
- `lint` — Prettier and ESLint.

Tests use temporary queues, never a personal deployment database.
