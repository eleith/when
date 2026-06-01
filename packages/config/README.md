# @when/config

Shared configuration loading and schema for the `when` workspace.

Owns the canonical `config.yaml` schema (`src/config.schema.json`), the
generated TypeScript types (`src/schema.d.ts`, via `json2ts`), and the loader
that parses, interpolates `${ENV}` references, validates against the schema, and
cross-checks references.

Consumed by `@when/web` (producer) and `@when/worker`. App-specific boot glue
(SvelteKit `$env`, metrics) stays in the consuming app.

## API

- `loadConfigFile(path)` — read + parse + validate a `config.yaml`.
- `validateConfig(raw)` — validate an already-parsed object.
- `interpolate(node, env?)` — expand `${ENV_VAR}` references.
- `ConfigError`, `MissingEnvVarsError` — typed failures.
- `schema` — the raw JSON Schema object.
- Types: `WhenConfiguration`, `EventType`, and the rest of the schema types.

## Scripts

- `pnpm generate:types` — regenerate `src/schema.d.ts` from the JSON schema.
- `pnpm build` — generate types, `tsc`, then copy the schema JSON into `dist`.
- `pnpm test` / `pnpm lint`.
