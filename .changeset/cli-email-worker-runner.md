---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Run CLI email tests through the existing shared worker runner, removing duplicate reachability, enqueue and result-wait handling. Preserve actual errors, the 30-second wait and failure exit codes without resubmitting timed-out jobs.
