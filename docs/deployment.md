# Deployment

Use Docker Compose 2.24 or newer with the [sample](compose.yaml).
Start with the [quick start](../README.md#get-started) and
[example config](when.example.yaml).

## start up

Fill in `config/when.yaml`; no `.env` file is required. Keep the config private
and readable by container UID 1000; make `data/` writable by that UID.

```sh
docker compose up -d
```

Open your public proxy URL and `/admin`. Backend web port: 3000.

## reverse proxy

Set YAML `url.app` to your public HTTPS origin. The sample configures web to
trust `X-Forwarded-Proto`; the proxy must overwrite it and `X-Real-IP`, preserve
the public `Host` (including its port), and reject unexpected hosts. Keep the
backend loopback-only or private so clients cannot forge these headers.

If using `X-Forwarded-Host`, configure native `HOST_HEADER` and have the proxy
overwrite it too. Omit `PORT_HEADER` when Host already includes the port.
`ORIGIN` does not override SvelteKit 3's request origin.

## inspect logs

```sh
docker compose logs --tail=100 -f
```

`/healthz` reports liveness; `/admin/health` shows recorded service outcomes.

## environment variables

Optional `.env` values are available to YAML `${VAR}` references in web, worker
and CLI. Use `.env` or a service's Compose `environment` mapping; arbitrary shell
variables are not automatically passed into containers. Keep secrets private.
See the [environment example](.env.example) and
[config reference](config.md#environment-variables).

Change only the published web port:

```sh
WHEN_HTTP_PORT=8080 docker compose up -d
```

Other advanced overrides:

| Variable                                    | Purpose                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CONFIG_PATH`                               | Config location; production default `/app/config/when.yaml`.                                 |
| `WHEN_DATABASE_PATH` / `WHEN_QUEUE_DB_PATH` | Override YAML database paths.                                                                |
| `WHEN_PUBLIC_DIR`                           | Override the deployment's `public/` directory.                                               |
| `PORT`                                      | Per-service listen port: web 3000, worker 9000. Keep healthchecks and internal URLs aligned. |
| `WHEN_URL_INTERNAL`                         | Default for YAML `url.internal`.                                                             |

Keep runtime `PORT` overrides out of the shared `.env`. After changing container
environment values, run `docker compose up -d --force-recreate`.

Without a configured session key, web restarts sign everyone out. Set YAML
[`auth.secret`](config.md#auth) or retain `AUTH_SECRET` for persistent sessions.

## persistence

Back up both SQLite databases with SQLite-aware tooling; live file copies can
miss WAL data. Keep private config, optional `.env` and branding overrides too.

## updates

Update web, worker and CLI together. Stop producers, drain old jobs with the old
worker, then stop it and back up both databases before starting new versions.
Don't replay unfinished jobs through changed workflow graphs.

## Helper CLI

```sh
docker compose run --rm when-cli config validate --check-env
```

Use `docker compose run --rm when-cli --help` for config, provider, calendar,
database and email commands. Some write config/data or send real mail.
