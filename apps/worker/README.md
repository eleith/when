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
starts polling with one execution slot, and serves `/healthz`.

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

Relative paths resolve against the config file's directory, so web and worker
(sharing one `when.yaml`) open the same files.

## Environment

- `CONFIG_PATH` — path to `when.yaml` (default `/app/config/when.yaml` in prod,
  `<cwd>/config/when.yaml` otherwise).
- `DATABASE_PATH` / `QUEUE_DB_PATH` — optional escape hatches that override the
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

An email `failed` action means a provider attempt failed and retries may remain.
The parent records `done` only when every intended email was sent and the appointment
still exists and is not purged. Ineligible deliveries are skipped. Exhaustion fails
the engine run rather than returning a successful summary of failed delivery.

Purge deletes each remote event with up to thirty native attempts (one-minute
initial delay, doubling up to one hour). Success or an already-missing event permits
video cleanup and local deletion. Exhaustion fails the job, retaining that row and
all later rows in the chain. These rows are already marked `purged` and hidden from
normal scheduling; another purge click does not automatically recover them. Review
failed jobs before deciding how to finish cleanup.

Prepared envelopes include personal data and guest capability links: treat queue
backups like application backups. Checkpoints do not guarantee exactly-once SMTP;
a crash after remote acceptance but before saving success can still cause a duplicate.

Before deploying these changed workflows, stop producers, let the old worker drain
unfinished jobs, then stop it and back up both databases before a grouped restart.
Do not replay unfinished old workflow histories through the changed step graph.

## Engine integration

Engine polling, schedule, heartbeat, and execution diagnostics go through the
worker's Pino logger. The adapter emits operational categories without forwarding
arbitrary engine error text or payloads that may contain credentials or guest links.

The existing job metrics describe **handler executions**, including replays. An
escaped handler execution may mean durable suspension rather than a terminal job
failure. Email metrics count physical SMTP attempt outcomes, not an exactly-once
delivery ledger.

OpenWorkflow `0.11.0` supports persisted cron schedules. Refresh, expiry, and repair
still use the existing process timers; migrating those tasks to awaited cron
workflows is a separate application change.
