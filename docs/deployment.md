# Deployment

Use Docker Compose with the [sample](compose.yaml). There are other ways; you're
welcome to them.

Start with the [quick start](../README.md#get-started) and
[example config](when.example.yaml).

## start up

Make `data/` writable by container UID 1000, or SQLite won't start.

```sh
docker compose up -d
```

Web listens on backend port 3000. Open the public proxy URL, not the backend.

## reverse proxy

Production browser access requires a trusted reverse proxy. Set
`PROTOCOL_HEADER=x-forwarded-proto`; the proxy must overwrite `X-Forwarded-Proto`
with the public scheme and preserve the public `Host`, including any non-default
port. Reject inappropriate public hosts and keep the backend loopback-only or
private so clients cannot bypass the proxy and supply trusted headers themselves.
The adapter trusts these headers; it does not authenticate the proxy.

If your proxy forwards the public authority in `X-Forwarded-Host` instead, set the
native `HOST_HEADER=x-forwarded-host` only with a matching proxy overwrite policy.
Do not set `PORT_HEADER` when the authority already includes the port.

`ORIGIN` supplies When's `url.app` default for authentication and generated links;
SvelteKit 3's native adapter ignores it. The configured public URL and the request
origin derived from proxy headers must agree. An explicit YAML `url.app` overrides
that default, not the adapter's request origin. Internal health and branding GETs
can still use backend HTTP.

## inspect logs

```sh
docker compose logs --tail=100 -f
```

Visit `/healthz` for liveness and `/admin/health` for recorded service outcomes.

## environment variables

Copy the [environment example](.env.example) to `.env` beside `compose.yaml` and
supply real values. After editing `.env`, run `docker compose up -d --force-recreate`.
A restart keeps the old environment.

| Variable          | Used for                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`     | Required Better Auth secret. Generate 32 random bytes with `openssl rand -base64 32`.                          |
| `ORIGIN`          | Public base URL, no trailing slash. Default for When's `url.app`, used for auth and links; not an adapter override.        |
| `PROTOCOL_HEADER` | Set to `x-forwarded-proto` behind the trusted production proxy, which must overwrite it with the public scheme.             |

Other secret names come from `${ENV_VAR}` references in your config. The example
uses:

| Variable                             | Needed for                                                       |
| ------------------------------------ | ---------------------------------------------------------------- |
| `WHEN_ADMIN_PASSWORD`                | Credentials sign-in.                                             |
| `WHEN_OIDC_CLIENT_SECRET`            | OIDC sign-in.                                                    |
| `WHEN_SMTP_PASSWORD`                 | SMTP.                                                            |
| `WHEN_PROVIDER_<NAME>_PASSWORD`      | CalDAV or Nextcloud.                                             |
| `WHEN_PROVIDER_<NAME>_CLIENT_SECRET` | Google.                                                          |
| `WHEN_PROVIDER_<NAME>_REFRESH_TOKEN` | Connected Google provider; obtained through admin, not invented. |

Advanced overrides:

| Variable                                    | Default / purpose                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CONFIG_PATH`                               | `/app/config/when.yaml` in production; normally `<cwd>/config/when.yaml` otherwise.             |
| `WHEN_DATABASE_PATH` / `WHEN_QUEUE_DB_PATH` | Override `database.app` / `database.queue`.                                                     |
| `WHEN_PUBLIC_DIR`                           | Override `<deployment root>/public`.                                                            |
| `PORT`                                      | Web: 3000 in the production image. Worker: 9000. Don't give both the same override by accident. |
| `WHEN_URL_INTERNAL`                         | Default for `url.internal`, the worker-to-web address. Docker targets supply it.                |

## persistence

Back up both SQLite databases with SQLite-aware tooling; live file copies can miss
WAL data. Keep config, `.env` and branding overrides too. These contain private data.

## updates

Update web, worker and CLI together. Stop producers, drain old jobs with the old
worker, then stop it and back up both databases before starting new versions.
Don't replay unfinished jobs through changed workflow graphs.

## Helper CLI

`when-cli` validates config and asks the worker to test services. Some commands
write config or databases, refresh busy times, or send real mail. Not a dry run.

Using the sample's environment and shared data mounts:

```sh
docker compose run --rm when-cli config validate --check-env
```

| Command                      | Effect                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `config init`                | Write starter YAML; refuse to overwrite.                                                           |
| `config validate [path]`     | Check shape and cross-references; `--check-env` checks environment values too. Nonzero on failure. |
| `provider list`              | Read recorded provider status; no network call.                                                    |
| `provider test <name>`       | Authenticate through the running worker and record the outcome.                                    |
| `provider calendars <name>`  | Discover calendar `id` / `href` values through the worker.                                         |
| `calendar list`              | List configured calendars.                                                                         |
| `calendar test <name>`       | Refresh that calendar's busy mirror and record status.                                             |
| `db status` / `db migrate`   | Report schema state / apply pending app migrations.                                                |
| `email test you@example.com` | Send a real branded test email through the worker.                                                 |
