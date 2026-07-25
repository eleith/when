# Development

Working on "When" locally. Read [`architecture.md`](architecture.md) for how the system
fits together and [`philosophy.md`](philosophy.md) for the principles changes are
measured against.

## Setup

Requires Node 26 (pinned in `mise.toml`) and pnpm. Install dependencies:

```sh
pnpm install
```

## Running locally

```sh
pnpm dev
```

\`pnpm dev\` runs only the **web** app. To also deliver appointment emails and sync calendars,
run the worker against the same config in a second terminal:

```sh
CONFIG_PATH=apps/web/config/when.yaml pnpm --filter @when/worker dev
```

See [`apps/worker/README.md`](../apps/worker/README.md) for worker specifics. For a
hot-reloading stack in Docker:

```sh
pnpm dev:docker
```

## Scripts

Each package exposes the same script names; run one with `pnpm --filter @when/<pkg> <script>`,
or across the workspace from the root.

- `build` — compile / typecheck the package.
- `check` — typecheck (`tsc --noEmit`, or `svelte-check` for web).
- `lint` — Prettier (covers Markdown too) + ESLint.
- `test` / `test:coverage` — Vitest.

Run the test suites from the root:

```sh
pnpm test        # unit tests (Vitest)
pnpm test:e2e    # Playwright (requires browsers installed)
```

## Testing

Unit tests are co-located `*.test.ts` files next to the code. Keep domain logic testable
by **injecting dependencies** rather than reaching for globals — a `Clock` for time, a
fake `Mailer` for email, a fake workflow `step` for jobs. End-to-end tests live in
`apps/web/e2e` (Playwright).

E2E runs a production build against a self-contained fixture environment, never your own
setup. `playwright.config.ts` builds and previews the app on port **4183** with
`CONFIG_PATH` pointed at `apps/web/e2e/fixture/config/when.yaml`, which also makes
`e2e/fixture/` the deployment root — so the suite's SQLite files land in
`e2e/fixture/data/` (gitignored, dropped before every run) instead of `apps/web/data/`.
`AUTH_SECRET` and `ENCRYPTION_KEY` are set to throwaway values in `webServer.env`, because
`vite preview` feeds `.env` into `$env/dynamic/private` only and never into `process.env`.
Your `config/when.yaml`, `data/`, and dev server on 5173 are untouched, so the two can run
side by side. Browsers install once with
`pnpm --filter @when/web exec playwright install chromium`.

## Conventions

- **Tooling:** pnpm and Node 26 only — no bun, no `npm`/`npx`. Run TypeScript CLIs under
  `tsx`.
- **Exact versions:** pin dependencies exactly (no `^`/`~` ranges); add with
  `pnpm add -E`. Shared tool versions live in the `pnpm-workspace.yaml` catalog
  (`"catalog:"`).
- **Type safety at boundaries:** validate every external input (YAML, forms, API) against
  the config JSON Schema (ajv) — the repo does not use Zod. Database access goes through
  Kysely.
- **Time:** never call `new Date()` / `Date.now()` in domain logic; inject a `Clock`.
- **Comments:** comment non-obvious rationale only. Don't restate what a name already
  says.
- **Secrets:** keep secrets in `${ENV_VAR}` references, never in committed config. Never
  log request bodies, session tokens, `cancel_token`s, or decrypted secrets.
- **Styling:** theme variables only, no Tailwind, copy in the markup — see the
  [styling section](architecture.md#styling-and-theming-web) of the architecture doc.

### Changing the config schema

[schema.ts](file:///home/eleith/dev/when/packages/config/src/schema.ts) (TypeBox) is the source of truth. After editing it, regenerate the relaxed JSON Schema:

```sh
pnpm --filter @when/config generate:schema
```

(This runs as part of `pnpm --filter @when/config build`.) Update [config/when.example.yml](file:///home/eleith/dev/when/apps/web/config/when.example.yml) and the fixtures if you add or change a field — the web app's `example.test.ts` fails until the example documents every schema field.
