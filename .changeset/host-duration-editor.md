---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Let hosts change an existing appointment's duration without moving its start time or replacing the booking. Check actual busy-time conflicts while ignoring buffers, daily caps and working hours. Keep calendar/invite updates, duration history and existing edit notifications consistent, and distinguish saved changes from unconfirmed background-update submission.
