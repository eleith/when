---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Read and edit the current appointment in one write transaction so older forms and concurrent partial edits cannot overwrite newer omitted fields. Preserve existing video-link choices, edit history, revision updates and notification behavior.
