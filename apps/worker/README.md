# @when/worker

The `when` worker is a long-running Node service for appointment side effects,
calendar maintenance, and on-demand service probes. Built on
[OpenWorkflow](https://openworkflow.dev) `0.11.0` over `node:sqlite`, it shares the
`when.sqlite` app DB and the `openworkflow.sqlite` queue with producers.

Web enqueues `reconcile-appointment` when an appointment changes. The worker
coordinates calendar/video updates, renders emails, sends them over SMTP, and
records outcomes in the appointment action log and service status. It also handles
purge, calendar-repair requests, video-link generation, and service probes. On boot
it loads config, migrates the app DB, connects the queue, registers workflows,
starts polling with one execution slot and a 30-second lease, and serves `/healthz`.
Native `worker.start()` persists declared schedules before startup enqueues all three
maintenance passes with `{}` and no run options.

## Run it

```sh
# from the repo root; build is a tsc compile to dist/ (run with node)
pnpm --filter @when/worker build && pnpm --filter @when/worker start

# or watch mode in dev, pointed at the shared config. The app + queue DB paths
# come from that config's `database` section, resolved relative to it — so this
# opens apps/web/data/{when.sqlite,openworkflow.sqlite}, same as web.
CONFIG_PATH=apps/web/config/when.yaml pnpm --filter @when/worker dev
```

`GET http://localhost:9000/healthz` → `{"status":"ok"}`.

## Configuration

Database locations live in `when.yaml` (the source of truth), not env vars:

```yaml
database:
  app: ./data/when.sqlite # default
  queue: ./data/openworkflow.sqlite # default
```

Relative paths resolve against the config directory's parent (the deployment root), so web and worker
(sharing one `when.yaml`) open the same files.

## Environment

- `CONFIG_PATH` — path to `when.yaml` (default `/app/config/when.yaml` in prod,
  `<cwd>/config/when.yaml` otherwise).
- `WHEN_DATABASE_PATH` / `WHEN_QUEUE_DB_PATH` — optional escape hatches that override the
  config's `database.app` / `database.queue`.
- `PORT` — health server port (default `9000`).

## Scripts

- `pnpm dev` — build once, then `tsc --watch` + `node --watch dist/src/index.js`
  (source changes rebuild and restart).
- `pnpm build` — `tsc -p tsconfig.build.json` → `dist/`.
- `pnpm start` — `node dist/src/index.js`.
- `pnpm check` / `pnpm lint` / `pnpm test` / `pnpm test:coverage`.

## Appointment jobs

Reconciliation saves prepared email content and recipient roles, then starts one
`deliver-appointment-email` child per recipient. Each child has five native SMTP
attempts (30-second initial delay, doubling up to ten minutes). A successful send
is checkpointed separately from its status write. Host and guest keep independent
retry budgets, even when they share an email address.

Purge deletes each remote event with up to thirty native attempts (one-minute
initial delay, doubling up to one hour). Exhaustion fails the job and retains the
current and later hidden `purged` rows, including local personal data. Clicking
purge again is not promised recovery; cleanup requires explicit operator review.

Email action logs describe attempts, not terminal job outcomes. See
[interpreting outcomes](../../docs/deployment.md#interpreting-outcomes) for email
log/service-status meanings and purge recovery guidance.

Prepared envelopes include personal data and guest capability links: treat queue
backups like application backups. Effects are at-least-once: a crash after remote
acceptance but before saving success can still duplicate effects or action-log entries.
Metrics and logs are not exactly-once ledgers.

Deploy web, worker and CLI together only after draining old work. Follow the
[grouped rollout runbook](../../docs/deployment.md#grouped-workflow-rollout) for read-only
inspection, paired SQLite backups, restore verification and rollback restrictions.
Do not replay unfinished old workflow histories through changed step graphs.

## Engine integration

Engine polling, schedule, heartbeat, and execution diagnostics go through the
worker's Pino logger. The adapter emits operational categories without forwarding
arbitrary engine error text or payloads that may contain credentials or guest links.

The existing job metrics describe **handler executions**, including replays. An
escaped handler execution may mean durable suspension rather than a terminal job
failure. Email metrics count physical SMTP attempt outcomes, not an exactly-once
delivery ledger.

## Maintenance and shutdown

| Workflow                      | UTC cron       | Stable schedule ID                 | Result      |
| ----------------------------- | -------------- | ---------------------------------- | ----------- |
| `refresh-calendars`           | `*/5 * * * *`  | `when:refresh-calendars`           | `refreshed` |
| `expire-pending-appointments` | `0 * * * *`    | `when:expire-pending-appointments` | `expired`   |
| `sync-calendars`              | `*/10 * * * *` | `when:sync-calendars`              | `requested` |

All inputs are `{}`. Each handler awaits the actual pass in durable steps; `requested`
means the scan finished, not that an in-memory request was accepted. Refresh checks
per-calendar due intervals, keeps stale mirrors on provider fetch failure, and runs
before conflict checks. Expiry SQL is idempotent and dirties newly expired pending rows
for repair; already-expired equal-revision rows are not backfilled. Subsequent callbacks
read live config.
Expected provider failures record status for later passes; local errors escape to native
retries. Completion is not a promise that every provider succeeded.

Mirror freshness is proven only by the latest successful calendar refresh or calendar
test, including an empty result. Pushes, failures and unknown/inconsistent observations
make a calendar due on the next pass, even when an older success timestamp remains.
Provider authentication/discovery does not refresh a mirror. The worker and web health
share this evidence check: untrusted refresh time is unknown, while explicit errors
remain failures. This conservative policy can fetch more often during push traffic or
sustained failure; it adds no timestamp column or freshness history.

Cron follows UTC wall-clock boundaries, not time since the last pass finished. After
downtime it dispatches one overdue run per schedule. Native startup upserts preserve
administrative pause state, but independent startup runs still execute while paused;
startup and overdue runs can coexist. See [schedule management](../../packages/jobs/README.md#schedule-management)
for the public list/pause/resume/delete API; removing declarations does not retire stored schedules.

No application maintenance timers or coalescers remain. Every cron/manual request gets
its own pass. One slot serializes active work: slow calls block appointment jobs and
probes, and repeated scans can build a backlog. Native retry delays park and release
the slot. Ordinary function steps use the engine default of ten attempts, one-second
initial delay, doubling to a 100-second cap. Workflow backstops are not extra provider
budgets; claim counts include resumes, and native exhaustion is terminal. Bookkeeping
failures can consume step attempts too: these limits are not exact physical-call counts.

Signals and config restarts share shutdown: stop config watching and HTTP admission,
await `worker.stop()`, finish HTTP closure, close the queue, then close the app DB.
Stop waits for active passes to finish or park, not for pending work/future retries;
it is not queue draining. Force-kill recovery relies on saved history and lease expiry.
