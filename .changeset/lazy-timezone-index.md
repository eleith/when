---
'@when/web': patch
---

Build the timezone search index in small client-side batches only when the picker is first opened, rather than during server rendering or page hydration. Show a loading state while keeping search and close controls usable, reuse the completed index, and allow retrying failed initialization.
