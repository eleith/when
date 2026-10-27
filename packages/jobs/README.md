# @when/jobs

Shared workflow contracts and OpenWorkflow queue access for web, CLI and worker.
Producers enqueue work; the worker implements it.

Opening a queue client runs migrations. Follow the
[update guidance](../../docs/deployment.md#updates) before
connecting a new version to an old queue.
