---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Run refresh, pending expiry and calendar repair as awaited native UTC cron workflows, with independent startup passes and pause-preserving schedule persistence. Remove application maintenance timers and coalescing; one execution slot serializes passes, so slow maintenance can delay other jobs. Stop the worker before closing queue and application databases.

Document attempt-level email outcomes, retained personal data after purge failure, sensitive queue backups, and the drained grouped rollout with paired SQLite backup/restore checks. Deploy web, worker and CLI together only after all old work drains; rollback requires proven compatibility or explicit approval for paired restore and loss of later writes.
