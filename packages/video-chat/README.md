# @when/video-chat

Callers can obtain a `VideoChatAdapter` from the configured service, supplying
an event binding for Google:

```ts
const adapter = getVideoChatAdapter(service, bookingEvent);
const result = await adapter.request({ name, requestId });
```

The shared contract has three operations:

- `request({ name, requestId })` requests a link. The name labels a standalone room;
  the request ID supports providers with creation idempotency.
- `read(knownUrl)` observes the provider resource. The URL may be `null` when no
  standalone room is known yet.
- `removeLink(knownUrl)` removes the provider's link or room, not appointment data.

The factory selects from `service.type`. Nextcloud uses its server configuration;
Google requires the already-booked event supplied as the second argument. The
Google implementation owns that event dependency, not the shared interface.

Google reads and updates conferencing on that event; removal does not delete the
booking event. Its event operations are backed by `@when/calendar`, without a
reverse package import. The event object stays in memory, not in checkpoints.

Nextcloud creates, reads and deletes standalone rooms. A missing URL means no known
room; a failed lookup of a known URL is not evidence that it is safe to replace it.
`nextcloudRoomToken` identifies canonical room aliases within one installation.

A successful observation may be ready, pending, absent, failed or ambiguous.
`ok: false` means the I/O operation failed, not that a conference is absent.
The worker owns current-choice and reference checks, native checkpoints, retries,
appointment writes and notification handoff. Adapters do no polling or persistence.
