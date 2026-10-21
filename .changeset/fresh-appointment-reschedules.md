---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Read the current appointment and create its rescheduled successor in one write transaction. Preserve current notes, video choices, guest details, calendar references, history and ICS sequence while honoring explicit form overrides.
