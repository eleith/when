---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Centralize appointment-time availability checking and pass database access explicitly. Keep existing booking rules, self-exclusion and create/reschedule busy-data windows unchanged while removing duplicated route calculations.
