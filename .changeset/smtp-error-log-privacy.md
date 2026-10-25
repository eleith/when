---
'@when/worker': patch
---

Avoid logging raw SMTP rejection messages, which may contain recipient addresses or message content. Log the numeric SMTP failure status when available while preserving the detailed failure reason for the caller.
