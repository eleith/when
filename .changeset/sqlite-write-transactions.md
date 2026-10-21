---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Add an explicit SQLite write transaction for short read-modify-write operations. Reserve write access before reading so another process cannot invalidate the transaction's snapshot before its update. Existing callers remain unchanged.
