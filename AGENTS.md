# Agent Instructions for "When"

When an AI agent or LLM is working on this repository, they must strictly adhere to the following project philosophy, architectural constraints, and coding guidelines.

## 1. Project Philosophy

- **Target Audience:** The individual self-hoster. "When" is explicitly designed for ONE schedulable user.
- **Radical Simplicity:** We reject multi-tenancy, team routing, and complex enterprise logic. Keep the surface area small and testable.
- **Configuration over UI:** Application state relies heavily on `config.yaml`. Administrative overhead is kept low.
- **No "Just In Case" Code:** Do not build abstract interfaces or complex routing logic for future features. Implement only what is required for the single-user scope.
- **Explicit Over Implicit:** Avoid "magic." Errors should be explicit with clear logging.

## 2. Architectural Constraints

- **The Stack:** Bun (Runtime, Package Manager, Test Runner), SvelteKit (Framework), TypeScript (`strict: true`), SQLite (`bun:sqlite`), Kysely (Query Builder), Zod (Validation).
- **Embrace Bun:** Go "all in" on Bun. Use `Bun.serve`, `Bun.file`, `bun:sqlite` freely. Do not abstract for a theoretical Node.js fallback.
- **Type Safety Everywhere:** External inputs (YAML, API, forms) MUST be validated with Zod. Database interactions MUST use Kysely.
- **Database & State:** State lives entirely in `data.sqlite` and `config.yaml`. Database migrations run automatically on container startup.
- **Time & Timezones:** Never call `new Date()` or `Date.now()` inline in domain logic. Inject a `Clock` service (`now()`) so tests can pin time. Use `@js-temporal/polyfill` for all zoned datetime math.
- **No External Runtime Requests:** The app makes no runtime calls to third-party services beyond explicitly configured ones (Google Calendar, CalDAV, SMTP, OIDC). All fonts, icons, and assets must be bundled locally.

## 3. UI and Styling

- **No Tailwind CSS:** Avoid utility-first CSS frameworks.
- **Components:** Use **Bits UI** for headless, accessible component primitives.
- **Styling:** Style components using Svelte's native `<style>` blocks (scoped CSS). Maintain a `reset.css` and a minimal `global.css`.
- **Theming:** User-defined branding (from `config.yaml`) is injected as CSS Variables (e.g., `--accent`) at the root layout level.
- **Theme Variables Only:** All CSS values (colors, spacing, font sizes, radii, shadows, transitions) MUST use the custom properties defined in `src/lib/styles/theme.css`. Hardcoded values are forbidden. See `docs/styling.md`.

## 4. Security & Secrets

- Passwords are stored only as argon2/bcrypt hashes.
- Anything secret must be injectable via `${ENV_VAR}` interpolation in the `config.yaml`.
- Secrets persisted to SQLite (OAuth refresh tokens) must be encrypted at the column level with AES-256-GCM using the `ENCRYPTION_KEY` env var.
- Never log raw request bodies, session tokens, `cancel_token` values, or decrypted secrets.

## 5. Documentation

For deep dives into specific areas, consult the `docs/` directory:

- `docs/architecture.md` - Detailed architectural decisions.
- `docs/features.md` - Core capabilities and workflows.
- `docs/data.md` - Static config and SQLite schema definitions.
- `docs/availability-algorithm.md` - Detailed specification of the slot-generation pipeline.
- `docs/google-oauth.md` - How the Google Calendar OAuth integration works.
- `docs/styling.md` - CSS variable system and hardcoded-value prohibition.
