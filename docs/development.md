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
or across the workspace with `pnpm -r <script>`. Root `build`, `check`, `lint`, and
`format` target the web app; root `test` and `test:coverage` run every workspace package.

- `build` — compile / typecheck the package.
- `check` — typecheck (`tsc --noEmit`, or `svelte-check` for web).
- `lint` — Prettier (covers Markdown too) + ESLint.
- `test` / `test:coverage` — Vitest.

Build shared packages after installing dependencies or changing package source, then run
from the root:

```sh
pnpm build:packages
pnpm test           # all workspace Vitest suites, including integration tests
pnpm test:coverage  # the same suites with coverage
pnpm test:e2e       # Playwright (requires browsers installed)
```

For a focused feedback loop, use `pnpm --filter @when/<pkg> test <file>`.

## Testing

Vitest tests are co-located `*.test.ts` files next to the code. Integration tests use
`*.integration.test.ts` and run in the same suite. End-to-end tests live in
`apps/web/e2e` (Playwright).

### What earns a test its place

Prefer readable, focused regression protection over a coverage percentage. Existing
coverage thresholds are guardrails, not a target to maximize.

- **Name the behavior and observe its outcome.** Assert the saved row, returned result,
  rendered text, or external request that matters. A test claiming to distinguish two
  outcomes needs fixture data that makes those outcomes distinguishable.
- **Use the cheapest layer that proves the contract.** Pure calculations and validation
  belong in unit tests; transactions, migrations, and durable retries need real SQLite
  or workflow integration; hydration and browser navigation need Playwright.
- **Mock at boundaries, not through the behavior being tested.** Inject a `Clock`, fake
  `Mailer`, or fake provider. Use the real workflow engine when the claim concerns
  checkpoint persistence or retry policy.
- **Make setup explicit and isolated.** Prefer small named fixtures with scenario-specific
  overrides. Do not rely on test ordering, another test's rows, developer config, or a
  shared temporary filename.
- **Permit harmless refactoring.** Assert accessible behavior and meaningful copy rather
  than source strings, incidental wrappers, object identity, or exact CSS dimensions.
  Exact output is appropriate when it is the contract, such as an ICS field or escaping.
- **Budget runtime and duplication.** Keep each behavior at its lowest sufficient layer;
  an E2E journey need not repeat a unit-test matrix. Measure slow scenarios before
  deleting them: remove unnecessary waits before sacrificing integration evidence.
- **Keep failures actionable.** Test names should explain the expectation. Use bounded,
  condition-based waits, retain diagnostics, and investigate retry-recovered failures.

### End-to-end

E2E covers what only a browser and a real server round trip can prove: SSR through
hydration, form actions and redirects, the auth gate as an HTTP boundary, and the client
router reconciling URL state. Availability maths, validation and templates stay in Vitest,
where they are cheaper. Browser scenarios also cover guest capabilities, host editing,
conditional forms, timezone persistence, and theme initialization.

It builds once, then runs the production adapter handler in one isolated server per
Playwright worker (four by default, overridable with `--workers`). Each server has its
own OS-assigned localhost port, copied fixture config, and app/queue databases under a
unique `e2e/fixture/data/run-*` directory. Setup copies the web source, static assets,
package manifest and build configs into a fresh project there, sharing only installed
dependencies. It uses the normal Vite/SvelteKit configuration in every build phase;
no previous build output is copied or required. Keep the explicit input list in
`e2e/setup.ts` in step with any new local imports in the build configs.

Kit and adapter build output stay inside the run directory, so another build cannot
replace a running test server's route chunks. The build and servers do not load
developer dotenv files or inherit application settings. Your `config/when.yaml`,
`data/`, build output, and dev server remain untouched; no existing server is reused.

Specs import `test` and `expect` from `./support/test.ts`. Its automatic fixture clears
appointment, busy-mirror, service-status and queue rows before each test, preserving
migration bookkeeping and live database connections. No background worker runs: tests
assert queue admission, not email delivery or calendar publication. Servers stop before
the run directory is removed.

- **Use the fixture's URL.** `page` and `request` receive the worker's `baseURL`; pass it
  explicitly to additional browser contexts, cookies, and Origin headers. Never hardcode
  a port.
- **Derive dates.** Pick an available slot from the page, or use `support/dates.ts` for a
  future weekday and explicit scenario times. Tests need not reserve separate dates or
  slots for other tests, repeats, or retries.
- **Assert the intended result.** `support/seed.ts` creates states needed by a scenario;
  `support/database.ts` reads back the specific appointment and queued workflow. Use
  persisted assertions when a heading alone cannot prove what was saved.

A failed test retains a screenshot and server output in `apps/web/test-results/`; the
first retry also records a Playwright trace. CI rejects retry-recovered flaky tests.
Inspect the screenshot, server log, and trace when a test fails. A later passing run
does not explain an earlier failure; investigate its cause rather than adding retries.

Repeat scheduling tests locally without retries to check isolation, for example:

```sh
pnpm --filter @when/web test:e2e booking.e2e.ts chain.e2e.ts --repeat-each=3 --retries=0
```

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
- **Async readability:** assign awaited results to named variables before returning
  them or passing them as arguments.
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

## Releases

When uses [Changesets](https://github.com/changesets/changesets) with fixed app grouping (`apps/web`, `apps/cli`, `apps/worker`) so all deployable applications stay synchronized in versioning.

1. **Document changes:** when finishing a feature or fix, record a changeset:
   ```sh
   pnpm changeset
   ```
2. **Bump versions & changelogs:** when ready to release:
   ```sh
   pnpm version:apps
   ```
   Commit the resulting version bumps and changelog updates (`git commit -m "[when] release X.Y.Z"`).
3. **Tag & deploy:**
   ```sh
   pnpm tag:apps
   git push origin main --tags
   ```
   This triggers the automated container image builds in Woodpecker CI and GitHub Actions.
