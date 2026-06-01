# @when/worker

The `when` worker — a long-running Node service that runs jobs produced by the
web app (and, later, jobs it schedules itself). Built on
[openworkflow](https://openworkflow.dev) over `node:sqlite`, so it shares the
`when.sqlite` app DB and owns the `queue.sqlite` job DB.

The first job is sending booking emails (added in a later step). For now the
worker boots — loads config, migrates the app DB, connects the queue, starts an
(empty) worker, and serves `/health` — then idles.

## Run it

```sh
# from the repo root; build is a Vite SSR bundle (build/index.js)
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

- `pnpm dev` — `tsx watch` the entrypoint.
- `pnpm build` — Vite SSR bundle to `build/`.
- `pnpm start` — run the built bundle.
- `pnpm check` / `pnpm lint` / `pnpm test` / `pnpm test:coverage`.
