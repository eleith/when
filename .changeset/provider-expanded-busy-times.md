---
'@when/worker': patch
---

Ask CalDAV and Nextcloud servers to expand recurring events within the requested busy-time window, matching Google's existing server-expanded approach. Remove local recurrence processing, preserve each returned occurrence's actual bounds, and reject unexpanded or malformed data without replacing the last good busy mirror. Pin date-only and floating-time query selection to UTC to match their existing import interpretation. Read validated occurrence fields directly so component-marker text in descriptions cannot change busy times or hide cancellation/free status. Outgoing appointment invitations and calendar publishing are unchanged.
