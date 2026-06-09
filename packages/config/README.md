# @when/config

Shared configuration loading and schema for the `when` workspace.

Owns the canonical `config.yaml` schema (`src/config.schema.json`), the
generated TypeScript types (`src/schema.d.ts`, via `json2ts`), and the loader
that parses, interpolates `${ENV}` references, validates against the schema, and
cross-checks references.

The canonical schema keeps every defaulted field `required`, so the generated
types are strict (non-optional) and ajv fills the defaults at load. A generated
relaxed copy — `src/config.external.schema.json`, served at `GET
/schema/config.json` — drops those fields from `required` so an editor pointed at
it (`# yaml-language-server: $schema=…`) doesn't flag defaulted-but-omitted
fields as missing. Point a `config.yaml` at the relaxed copy, never the canonical
one.

Consumed by `@when/web` (producer) and `@when/worker`. App-specific boot glue
(SvelteKit `$env`, metrics) stays in the consuming app.

## API

- `loadConfigFile(path)` — read + parse + validate a `config.yaml`.
- `validateConfig(raw)` — validate an already-parsed object.
- `interpolate(node, env?)` — expand `${ENV_VAR}` references.
- `ConfigError`, `MissingEnvVarsError` — typed failures.
- `schema` — the canonical (strict) JSON Schema object.
- `externalSchema` — the relaxed, editor-facing copy.
- Types: `WhenConfiguration`, `EventType`, and the rest of the schema types.

## Scripts

- `pnpm generate:types` — regenerate `src/schema.d.ts` from the JSON schema.
- `pnpm generate:external-schema` — regenerate `src/config.external.schema.json`.
- `pnpm build` — generate types + the external schema, `tsc`, then copy both schema JSONs into `dist`.
- `pnpm test` / `pnpm lint`.
