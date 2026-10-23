---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Allow authenticated hosts to book and reschedule without guest buffer windows or daily booking caps. Keep guest restrictions, configured durations and all other availability checks unchanged, and use the same effective buffers for validation and timeline display.
