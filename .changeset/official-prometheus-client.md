---
'@when/web': patch
'@when/worker': patch
---

Replace deprecated prom-client with the official @prometheus-io/client and remove Node collectors and their background sampling. Aggregate private worker snapshots natively and expose worker collection health. Centralize instrumentation at operation boundaries, count appointment operation outcomes, and categorize SMTP/calendar failures without putting metric calls in business implementations.

Booking attempts now label unclassified failures `error` rather than `database_error`.
