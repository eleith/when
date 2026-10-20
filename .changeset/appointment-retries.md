---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Use native retries for appointment email delivery and purge cleanup. Guest and host emails run independently with checkpointed content, so retrying one delivery or recording SMTP status does not repeat another saved send. Exhausted remote-deletion retries now fail the purge and retain its remaining rows instead of abandoning remote cleanup and deleting local data.
