---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Use Kysely's native SQLite connection handling so concurrent queries cannot accidentally join another request's transaction or be undone by its rollback.
