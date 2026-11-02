---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Isolate configuration loading inputs and adopt a reusable, serialized reload monitor based on Directory's approach. Preserve existing path conventions and restart rules, retain accepted settings after invalid edits, and make cleanup available before startup reconciliation.
