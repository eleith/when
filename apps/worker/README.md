# @when/worker

The `when` worker — a long-running Node service that runs jobs produced by the
web app (and, later, jobs it schedules itself). Built on
[openworkflow](https://openworkflow.dev) over `node:sqlite`, so it shares the
`when.sqlite` app DB and owns the `queue.sqlite` job DB.

Its job is sending booking emails: web enqueues a `send-booking-email` run when a
booking is created, confirmed, cancelled, rescheduled, or declined, and the
worker renders the email(s), sends them over SMTP, and records the per-channel
outcome on the appointment (`email_notification_status`). On boot it loads
config, migrates the app DB, connects the queue, registers its workflows, starts
polling, and serves `/health`.

## Run it

```sh
# from the repo root; build is a tsc compile to dist/ (run with node)
pnpm --filter @when/worker build && pnpm --filter @when/worker start

# or watch mode in dev, pointed at the shared config. The app + queue DB paths
# come from that config's `database` section, resolved relative to it — so this
# opens apps/web/data/{when.sqlite,openworkflow.sqlite}, same as web.
CONFIG_PATH=apps/web/config.yaml pnpm --filter @when/worker dev
```

`GET http://localhost:9000/health` → `{"status":"ok"}`.

## Configuration

Database locations live in `config.yaml` (the source of truth), not env vars:

```yaml
database:
  app: ./data/when.sqlite # default
  queue: ./data/openworkflow.sqlite # default
```

Relative paths resolve against the config file's directory, so web and worker
(sharing one `config.yaml`) open the same files.

## Environment

- `CONFIG_PATH` — path to `config.yaml` (default `/app/config.yaml` in prod,
  `<cwd>/config.yaml` otherwise).
- `DATABASE_PATH` / `QUEUE_DB_PATH` — optional escape hatches that override the
  config's `database.app` / `database.queue`.
- `PORT` — health server port (default `9000`).

## Scripts

- `pnpm dev` — build once, then `tsc --watch` + `node --watch dist/src/index.js`
  (source changes rebuild and restart).
- `pnpm build` — `tsc -p tsconfig.build.json` → `dist/`.
- `pnpm start` — `node dist/src/index.js`.
- `pnpm check` / `pnpm lint` / `pnpm test` / `pnpm test:coverage`.

## Recurring jobs (future)

openworkflow has no native cron yet. When the worker needs periodic work — e.g. a
calendar refresh — schedule it itself: a `setInterval` that calls
`getOpenWorkflow().runWorkflow(spec, input, { idempotencyKey })` with a
time-bucketed key (e.g. `calendar-refresh:2026-06-05T12`), so a given bucket runs
at most once even if the interval double-fires or the process restarts (the same
pattern luzzle uses for its purge job). Swap to native cron once openworkflow
ships it.
