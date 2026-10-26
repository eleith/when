---
'@when/worker': patch
---

Use one library-backed XML reader for CalDAV REPORT imports and calendar discovery, replacing handwritten tokenization, entity decoding, and regex extraction. Retain busy-import validation and mirror preservation, correctly decode discovery names and hrefs, and match properties by namespace and structure. Accept Unicode prefixes and harmless processing instructions; retire the custom nesting ceiling while retaining the streamed REPORT text limit.
