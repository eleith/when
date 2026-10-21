---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Add explicit database operations to record an appointment's calendar-event reference and list the pending or confirmed appointments using an event. Existing callers and synchronization behavior remain unchanged.
