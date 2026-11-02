---
'@when/web': patch
'@when/cli': patch
---

Make first-time setup YAML-first without requiring an environment file. Accept an optional `auth.secret`, preserve existing `AUTH_SECRET` overrides, and otherwise generate a secure session key at web startup; restarting signs users out unless a stable key is configured.

Align Compose, configuration examples, CLI starter and setup documentation around existing service/path defaults, optional interpolation and advanced per-service overrides. Leave required passwords blank rather than shipping a shared admin login, create CLI starters with private permissions, and keep inline credentials out of YAML syntax diagnostics.
