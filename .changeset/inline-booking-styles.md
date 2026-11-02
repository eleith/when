---
'@when/web': patch
---

Raise the per-stylesheet inlining limit so booking and rescheduling include their initial styles in the HTML rather than waiting for a render-blocking CSS request. This applies across the app, trading larger HTML responses for fewer separate stylesheet requests; styles above the limit remain external.
