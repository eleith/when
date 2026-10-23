---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Separate calendar test and discovery feedback from recorded health, retaining actual error messages. Only successful discovery shows calendar results or an empty list. Use consistent, theme-aware feedback styling across health checks and stop the discovery loading indicator when its request ends.
