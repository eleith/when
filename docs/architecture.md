# Architecture Guidelines

This document outlines the core architectural principles, project layout, and styling rules for developing "When".

## Project Philosophy

- **Target Audience:** The individual self-hoster. "When" is explicitly designed for ONE schedulable user.
- **Radical Simplicity:** We reject multi-tenancy, team routing, and complex enterprise logic.
- **Configuration over UI:** Application state relies heavily on `config.yaml`. Administrative overhead is kept low.
- **Explicit Over Implicit:** Avoid "magic." Errors should be explicit with clear logging.

## Core Technologies

- **Runtime & Tooling:** Bun (Runtime, Package Manager, Test Runner).
- **Framework:** SvelteKit.
- **Database:** SQLite (`bun:sqlite`), managed via Kysely (Query Builder). Migrations run on boot and are idempotent.
- **Validation:** Zod for runtime data boundary validation.
- **Time Math:** `@js-temporal/polyfill` for all zoned datetime math. Never call `new Date()` inline in domain logic; inject a `Clock` service (`now()`) to enable pinned times in tests.
- **Calendar Data:** Outbound `.ics` and inbound CalDAV iCal both go through `ts-ics`.

## Design Patterns

### Calendar Adapter Pattern

To maintain the Open/Closed Principle and prevent deeply nested conditionals, "When" uses an Adapter pattern for external calendar integrations.

All external interactions (fetching busy times, pushing appointments, deleting events) are defined in a unified `CalendarAdapter` interface (`src/lib/server/calendar/adapter.ts`). Specific integrations (like CalDAV or Google Calendar) implement this interface in dedicated classes within the `src/lib/server/calendar/adapters/` directory.

A central factory function, `getCalendarAdapter(config)`, is the single source of truth for interpreting the `type` of a calendar from the user's `config.yaml`. The core scheduling engine interacts exclusively with this interface, making it trivial to add support for new calendar providers in the future without modifying core routing or availability logic.

### Svelte templates own user-facing copy

Per-component user-facing copy — page titles, status labels, button text, banner messages — belongs in the markup, not in `<script>`. If the only purpose of a function or `$derived` is to map a stable identifier to a display string, inline the mapping with `{#if}` chains directly where it renders.

No — indirection through a script-side mapper:

```svelte
<script>
	function clockStatusLabel(s) {
		/* maps 'upcoming' → 'Upcoming', etc. */
	}
</script>

<p>{clockStatusLabel(status)}</p>
```

Yes — copy lives where it renders:

```svelte
<p>
	{#if status === 'upcoming'}Upcoming
	{:else if status === 'in_progress'}In progress
	{:else}Concluded
	{/if}
</p>
```

`<script>` is for behavior: formatting transforms (`fmt(iso)` → localized date string), event handlers, derived state computed from real data. Pure identifier-to-copy mappings duplicate the template's job; inlining keeps presentation in one place and makes diffs reviewable without flipping between sections.

Exception: if a string repeats 3+ times in the same component, a `$derived` (still computed from data, not a mapper function) is cleaner than duplicating the conditional block.

## Directory Structure

- `cli/`: Command-line tools (e.g., `hash-password.ts`, `setup-google.ts`).
- `docs/`: Markdown documentation (you are here).
- `e2e/`: Playwright end-to-end tests.
- `src/lib/server/`: Core backend logic (domain services, database, config loading).
  - `src/lib/server/auth/`: Authentication logic.
  - `src/lib/server/availability/`: Slot calculation engine.
  - `src/lib/server/calendar/`: CalDAV and Google Calendar integrations.
  - `src/lib/server/db/`: Kysely setup and migrations.
- `src/lib/styles/`: Global CSS and theme variables.
- `src/routes/`: SvelteKit pages and API endpoints.
- `tests/`: Bun unit tests.

## Styling & Theming

"When" uses Vanilla CSS combined with Svelte's scoped `<style>` blocks. **Do not use Tailwind CSS.**

### The Rule of Variables

All visual styling MUST use the CSS custom properties defined in `src/lib/styles/theme.css`. Hardcoded values (hex colors, pixel literals for layout, raw font sizes) are strictly forbidden within component `<style>` blocks.

- **Colors:** Use semantic variables like `var(--primary)`, `var(--primary-muted)`, `var(--text)`, `var(--surface)`, `var(--border)`. There is one brand hue (`--primary`) with a tonal scale (`--primary-muted`, `--primary-border`, `--text-on-primary`); avoid introducing additional brand hues.
- **Spacing:** All padding, margins, and gaps must use `var(--space-1)` through `var(--space-10)`. Do not write raw pixel values for spacing.
- **Typography:** Use `var(--font-size-*)` for font sizing.
- **Radii:** Use `var(--radius-*)` (e.g., `var(--radius-md)`).
- **Shadows & Transitions:** Use `var(--shadow-card)`, `var(--transition)`.

### Dark Mode & Branding

Dark mode is handled automatically by media queries within `theme.css`. Components do not need explicit dark mode overrides. The `--primary` color is injected at the root layout level based on the user's `config.yaml` branding settings, with `--primary-muted` and `--primary-border` derived from it for the tonal scale.

## Testing

- Ensure new features have accompanying tests in the `tests/` directory.
- Domain logic should be easily testable by injecting dependencies like the `Clock`.
- E2E tests are located in `e2e/` and run against a full browser environment.
