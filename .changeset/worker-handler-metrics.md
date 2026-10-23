---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Change `when_jobs_total` status label values from `success`/`failure` to `returned`/`escaped`. These count handler executions, including durable suspension as an escape, not terminal workflow outcomes. Keep existing active-handler gauge and execution-duration semantics, and leave physical SMTP and calendar counter labels unchanged.

Use the native public SDK workflow handler type without a handwritten argument alias or cast.
