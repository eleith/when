---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Let automatic video generation own the original booking notification: make one bounded provider attempt, send the booking notice with or without its link, then retry and send a link-added update only when needed. Reuse the existing notification delivery pipeline; normal bookings and manual link updates retain their respective notices. Give the initial video attempt one shared five-second deadline; normal calendar operations and later retries do not inherit that limit.
