---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Add an optional appointment video-generation request for durable reconciliation. A missing request follows configured attachment rules; `generate` and `suppress` explicitly override them. Existing URLs and revisions remain unchanged.
