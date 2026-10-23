---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Include a validated workflow run ID in structured engine execution-error logs. Keep fixed log messages and continue discarding engine arguments, error payloads and malformed or extended message text.
