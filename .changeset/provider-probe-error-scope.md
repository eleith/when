---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Keep provider authentication and calendar discovery failures separate from failures to save their status. A failed status write now escapes without falsely marking the provider as broken.
