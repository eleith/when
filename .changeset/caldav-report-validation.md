---
'@when/worker': patch
---

Decode numeric XML character references in CalDAV responses and reject malformed Multi-Status XML or failed calendar-data properties before replacing the busy mirror. Valid empty responses still clear previously mirrored busy times.
