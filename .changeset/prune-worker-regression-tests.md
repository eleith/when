---
'@when/worker': patch
---

Prune duplicate worker workflow and email-dispatch tests while retaining their regression protection in existing application-level tests. Preserve fifth-attempt recovery, independent recipient budgets, restart behavior, and email routing and attachment checks. This is a test-only refinement; production behavior is unchanged.
