---
'@when/web': patch
'@when/worker': patch
'@when/cli': patch
---

Serve the generated editor configuration schema publicly at /schema.json from the deployed package. Require cache revalidation and expose only the schema, never loaded configuration or credentials.
