# Development

Working on "When" locally. Read [`architecture.md`](architecture.md) for how the system
fits together and [`philosophy.md`](philosophy.md) for the principles changes are
measured against.

## Setup

Requires Node 24 and pnpm. Install dependencies:

```sh
pnpm install
```

## Running locally

```sh
pnpm dev
```

`pnpm dev` runs only the **web** app. To also deliver booking emails and sync calendars,
run the worker against the same config in a second terminal:

```sh
CONFIG_PATH=apps/web/config.yaml pnpm --filter @when/worker dev
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

## Conventions

- **Tooling:** pnpm and Node 24 only — no bun, no `npm`/`npx`. Run TypeScript CLIs under
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

`packages/config/src/config.schema.json` is the source of truth. After editing it,
regenerate the derived artifacts:

```sh
pnpm --filter @when/config generate:types            # strict TypeScript types
pnpm --filter @when/config generate:external-schema  # relaxed editor schema
```

(Both run as part of `pnpm --filter @when/config build`.) Update
`apps/web/config.example.yaml` and the fixtures if you add or change a field.
