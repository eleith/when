# @when/config

Shared configuration loading and schema for the `when` workspace.

Owns the canonical config schema [schema.ts](file:///home/eleith/dev/when/packages/config/src/schema.ts) defined using TypeBox. The loader parses, interpolates `${ENV}` references, fills defaults (including a few that depend on siblings, e.g. a slug derived from a meeting name), validates with TypeBox, and performs cross-reference validation.

The source schema keeps every defaulted field strict (non-optional) so TypeScript types are strong. The generated JSON Schema ([config.schema.json](file:///home/eleith/dev/when/packages/config/src/config.schema.json)) is programmatically relaxed (omitted-but-defaulted fields are removed from `required` rules) so an editor pointed at it via `# yaml-language-server: $schema=...` doesn't flag them as missing. Point a `when.yaml` to this generated schema.

Consumed by `@when/web` (producer) and `@when/worker`. App-specific boot glue
(SvelteKit `$env`, metrics) stays in the consuming app.

## API

- `loadConfigFile(path)` — read + parse + validate a `when.yaml`.
- `validateConfig(raw)` — validate an already-parsed object.
- `interpolate(node, env?)` — expand `${ENV_VAR}` references.
- `ConfigError`, `MissingEnvVarsError` — typed failures.
- `schema` / `externalSchema` — the generated relaxed JSON Schema.
- Types: `WhenConfiguration`, `Meeting`, and all other statically generated TypeBox types.

## Scripts

- `pnpm generate:schema` — regenerate `src/config.schema.json` from `src/schema.ts`.
- `pnpm build` — run `generate:schema`, compile TS files via `tsc`, and build assets.
- `pnpm test` / `pnpm lint`.
