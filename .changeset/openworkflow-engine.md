---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Upgrade OpenWorkflow to 0.11.0 with single-slot child-workflow regression coverage. Route worker engine diagnostics through structured logging and expose explicit queue connection shutdown. Existing appointment workflows and maintenance timers are unchanged in this step.
