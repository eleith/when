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

## Engine integration

Engine polling, schedule, heartbeat, and execution diagnostics go through the
worker's Pino logger. The adapter emits operational categories without forwarding
arbitrary engine error text or payloads that may contain credentials or guest links.

The existing job metrics describe **handler executions**, including replays. An
escaped handler execution may mean durable suspension rather than a terminal job
failure. Email metrics count physical SMTP attempt outcomes, not an exactly-once
delivery ledger.

OpenWorkflow `0.11.0` supports persisted cron schedules. This engine-upgrade step
still uses the existing process timers for refresh, expiry, and repair; migrating
those tasks to awaited cron workflows is a separate application change. Likewise,
upgrading the engine alone does not change the current workflow error handling.
