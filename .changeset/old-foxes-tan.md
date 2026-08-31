---
'@when/worker': patch
---

caldav calendars were not skipping 'free' (not busy) events when calculating availability. this fix aligns expectations that were correct in google calendar event handling
