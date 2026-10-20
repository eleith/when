---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Use native retries for appointment email delivery. Guest and host emails run independently with checkpointed content, so retrying one delivery or recording SMTP status does not repeat another saved send.
