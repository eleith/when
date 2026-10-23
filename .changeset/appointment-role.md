---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Use one AppointmentRole (`host` or `guest`) through appointment actions, loaders, privacy projections and UI components instead of parallel admin flags or read-only viewer terminology. Preserve authentication, guest action restrictions, historical actors and admin URLs.
