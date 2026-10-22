---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Preserve the actual SMTP attempt time when retrying a status write, without resending a checkpointed email. Keep the existing last-recorded status policy: a delayed success may replace a newer failure and move the recorded timestamp backwards.
