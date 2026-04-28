# Styling & Theme Variables

All visual styling in "When" MUST use the CSS custom properties defined in `src/lib/styles/theme.css`. Hardcoded values (hex colors, pixel literals, raw font sizes, etc.) are forbidden within component `<style>` blocks.

## Variable Reference

### Colors

| Variable | Purpose |
|---|---|
| `--accent` | Primary brand color (injected by `+layout.svelte` from `config.yaml`) |
| `--text-on-accent` | Text color on accent backgrounds (always `#ffffff`) |
| `--text` | Primary body text |
| `--text-secondary` | Secondary / slightly muted body text |
| `--text-muted` | De-emphasized text (captions, hints) |
| `--text-disabled` | Disabled / inert text |
| `--surface` | Card / panel backgrounds |
| `--surface-page` | Page-level background |
| `--surface-muted` | Subtle surface variation (hover states, hatches) |
| `--surface-accent` | Accent-tinted surface (selected slots, available dates highlight) |
| `--border` | Light borders |
| `--border-strong` | Emphasized borders |
| `--success` / `--success-strong` / `--success-border` / `--success-bg` | Success state colors |
| `--danger` / `--danger-strong` / `--danger-border` / `--danger-bg` | Error / danger state colors |
| `--warning` | Warning state color |

### Spacing (`--space-N`)

| Variable | Value |
|---|---|
| `--space-1` | 2px |
| `--space-2` | 4px |
| `--space-3` | 8px |
| `--space-4` | 12px |
| `--space-5` | 16px |
| `--space-6` | 20px |
| `--space-7` | 24px |
| `--space-8` | 32px |
| `--space-9` | 48px |
| `--space-10` | 64px |

Always use these for `padding`, `margin`, `gap`, and any layout offsets. Do not write raw pixel values for spacing.

### Typography

| Variable | Value |
|---|---|
| `--font-size-xs` | 0.75rem |
| `--font-size-sm` | 0.8125rem |
| `--font-size-base` | 0.875rem |
| `--font-size-md` | 0.9375rem |
| `--font-size-lg` | 1rem |
| `--font-size-xl` | 1.25rem |
| `--font-size-2xl` | 1.5rem |
| `--font-size-3xl` | 1.75rem |
| `--font-size-display` | 3rem |
| `--font-family` | System font stack |

### Radii

| Variable | Value |
|---|---|
| `--radius-sm` | 6px |
| `--radius` | 8px |
| `--radius-md` | 12px |
| `--radius-pill` | 999px |

### Shadows

| Variable | Value |
|---|---|
| `--shadow-card` | Light elevation for cards/panels |
| `--shadow-focus` | Focus ring using `color-mix` with `--accent` |

### Transition

| Variable | Value |
|---|---|
| `--transition` | `0.15s` — use for hover/state transitions |

## Rules

1. **No hardcoded colors** — never write `#fff`, `#333`, `rgba(...)`, or color keywords like `white`/`black` in component styles. Use the semantic variables above.
2. **No hardcoded spacing** — all `padding`, `margin`, `gap` must use `var(--space-N)`.
3. **No hardcoded font sizes** — use `var(--font-size-*)`.
4. **No hardcoded border-radius** — use `var(--radius-*)`.
5. **No hardcoded transitions** — use `var(--transition)`.
6. **No hardcoded box-shadows** — use `var(--shadow-card)` or `var(--shadow-focus)`.

### Exceptions

- `border-radius: 50%` for circular elements (avatars) is acceptable — this is idiomatic CSS.
- Icon/element dimensions that are not layout spacing (e.g., `width: 10px` for a dot indicator) may use pixel values if no space variable matches.
- `border-left: 3px solid var(--border-strong)` — the `3px` border width is a deliberate emphasis choice, not a spacing value.

## Dark Mode

All variables are re-declared inside `@media (prefers-color-scheme: dark)` in `theme.css`. Components do not need to write their own dark-mode overrides — the variables flip automatically.

## Accent Branding

`--accent` is set by `+layout.svelte` from the user's `config.yaml` branding. Light and dark variants (`--accent-light`, `--accent-dark`) are injected as inline styles, then mapped to `--accent` via a media query. Never assume a hardcoded fallback for `--accent` — it is always defined.
