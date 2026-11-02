---
'@when/web': patch
---

Allow rescheduling to change the start time, duration, or both within the existing guest and admin constraints. Start with the current day and interval selected in the calendar wizard, retain the start when a new duration fits, and build a factual proposed-selection summary as changes are made. Keep navigation available and disable only final reschedule submission until the interval is valid and changed, with the same check inside the write transaction.

Restore pending guests' saved public location choices in the reschedule form without exposing private host-entered meeting details.
