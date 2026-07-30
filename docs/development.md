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

### End-to-end

E2E covers what only a browser and a real server round trip can prove: SSR through
hydration, form actions and redirects, the auth gate as an HTTP boundary, and the client
router reconciling URL state. Availability maths, validation and templates stay in Vitest,
where they are cheaper. Five specs — booking, deep links, auth, approval, cancellation.

It runs a production build against a self-contained fixture, never your own setup.
`playwright.config.ts` builds and previews on port **4183** with `CONFIG_PATH` pointed at
`e2e/fixture/config/when.yaml`, which also makes `e2e/fixture/` the deployment root, so the
suite's SQLite files land in `e2e/fixture/data/` (gitignored, dropped before every run)
rather than `apps/web/data/`. `AUTH_SECRET` comes from `webServer.env`,
because `vite preview` feeds `.env` into `$env/dynamic/private` only, never `process.env`.
Your `config/when.yaml`, `data/` and dev server on 5173 are untouched.

Two rules keep it stable, both learned the hard way:

- **Derive, never hardcode.** Availability is computed from the wall clock, so specs pick
  the first available day and read times back out of the page. The only literal date is the
  one the deep-link spec deliberately wants to be unavailable.
- **Assert on the row you seeded, never on totals.** Workers share one database.
  `e2e/support/seed.ts` writes appointments directly for states the UI cannot reach (a
  pending request, a past booking), giving each a unique id, token and start time — live
  rows are unique on `(event_type_id, start_time)`.

Running it needs `pnpm build:packages` first: `vite build` resolves `@when/*` to `dist/`,
not source. Browsers install once per Playwright version, and the version matters —
`@playwright/test` and the browsers on disk must match, or Playwright cannot find an
executable:

```sh
pnpm --filter @when/web exec playwright install chromium
```

CI runs the suite in both pipelines from a prebuilt image
(`eleith/containers` → `playwright`) that carries the browsers and Node 26. Its tag and
`@playwright/test` are a matched pair — **bump them together**. Publishing waits on the
suite in both pipelines.

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
