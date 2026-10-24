---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Offer hosts a finite set of booking lengths alongside configured choices. Preserve the current appointment length by default when rescheduling, allowing other lengths only when the requester may choose them. Keep new-booking defaults explicit and the duration picker reachable when a chosen length has no availability.
