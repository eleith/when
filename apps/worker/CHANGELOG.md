# @when/worker

## 0.1.0

### Minor Changes

- Release scheduling improvements, provider-expanded calendar imports and durable background workflows together as 0.1.0. Deploy web, worker and CLI as one version: drain old queued work before deploying changed workflow graphs, and back up both SQLite databases with all writers stopped.

### Patch Changes

- 43e29d4: Use native retries for appointment email delivery and purge cleanup. Guest and host emails run independently with checkpointed content, so retrying one delivery or recording SMTP status does not repeat another saved send. Exhausted remote-deletion retries now fail the purge and retain its remaining rows instead of abandoning remote cleanup and deleting local data.
- aee8312: Use one AppointmentRole (`host` or `guest`) through appointment actions, loaders, privacy projections and UI components instead of parallel admin flags or read-only viewer terminology. Preserve authentication, guest action restrictions, historical actors and admin URLs.
- 643e9cd: Let automatic video generation own the original booking notification: make one bounded provider attempt, send the booking notice with or without its link, then retry and send a link-added update only when needed. Reuse the existing notification delivery pipeline; normal bookings and manual link updates retain their respective notices. Give the initial video attempt one shared five-second deadline; normal calendar operations and later retries do not inherit that limit.
- 71143c1: Import all Google busy-event pages before replacing the mirror, interpret all-day events in the calendar's timezone, and make newly expired pending appointments discoverable for calendar cleanup.
- 8d3b943: Send booking notifications independently of background video generation. Persist Generate/Remove choices, checkpoint provider requests and guarded link publication, and send a neutral video-link-added update with a newer ICS sequence through the existing notification pipeline. Calendar publishing now preserves conferencing rather than generating or adopting links. Existing selected links are included immediately; missing links normally produce a separate follow-up even when generation is fast.
- 4539096: Centralize appointment-time availability checking and pass database access explicitly. Keep existing booking rules, self-exclusion and create/reschedule busy-data windows unchanged while removing duplicated route calculations.
- 06dbb76: Decode numeric XML character references in CalDAV responses and reject malformed Multi-Status XML or failed calendar-data properties before replacing the busy mirror. Valid empty responses still clear previously mirrored busy times.
- dbdd881: Add explicit database operations to record an appointment's calendar-event reference and list the pending or confirmed appointments using an event. Existing callers and synchronization behavior remain unchanged.
- c13d5ca: Separate calendar test and discovery feedback from recorded health, retaining actual error messages. Only successful discovery shows calendar results or an empty list. Use consistent, theme-aware feedback styling across health checks and stop the discovery loading indicator when its request ends.
- d166648: Share conservative busy-mirror freshness evidence between scheduling and web health so calendar pushes and failed observations cannot masquerade as successful refreshes.
- 8ff6c81: Run CLI email tests through the existing shared worker runner, removing duplicate reachability, enqueue and result-wait handling. Preserve actual errors, the 30-second wait and failure exit codes without resubmitting timed-out jobs.
- efd6e36: Include a validated workflow run ID in structured engine execution-error logs. Keep fixed log messages and continue discarding engine arguments, error payloads and malformed or extended message text.
- b36c073: Read and edit the current appointment in one write transaction so older forms and concurrent partial edits cannot overwrite newer omitted fields. Preserve existing video-link choices, edit history, revision updates and notification behavior.
- 086d677: Read the current appointment and create its rescheduled successor in one write transaction. Preserve current notes, video choices, guest details, calendar references, history and ICS sequence while honoring explicit form overrides.
- bf7a61b: Allow authenticated hosts to book and reschedule without guest buffer windows or daily booking caps. Keep guest restrictions, configured durations and all other availability checks unchanged, and use the same effective buffers for validation and timeline display.
- 5fe9d8b: Offer hosts a finite set of booking lengths alongside configured choices. Preserve the current appointment length by default when rescheduling, allowing other lengths only when the requester may choose them. Keep new-booking defaults explicit and the duration picker reachable when a chosen length has no availability.
- f8027fc: Let hosts change an existing appointment's duration without moving its start time or replacing the booking. Check actual busy-time conflicts while ignoring buffers, daily caps and working hours. Keep calendar/invite updates, duration history and existing edit notifications consistent, and distinguish saved changes from unconfirmed background-update submission.
- 4ff67f2: Show rejected host booking and rescheduling submissions using the existing form and field error displays, while preserving entered values, selected times and durations. Keep normal success and redirect handling unchanged.
- 7fbac28: Use one library-backed XML reader for CalDAV REPORT imports and calendar discovery, replacing handwritten tokenization, entity decoding, and regex extraction. Retain busy-import validation and mirror preservation, correctly decode discovery names and hrefs, and match properties by namespace and structure. Accept Unicode prefixes and harmless processing instructions; retire the custom nesting ceiling while retaining the streamed REPORT text limit.
- 6d21cc1: Run refresh, pending expiry and calendar repair as awaited native UTC cron workflows, with independent startup passes and pause-preserving schedule persistence. Remove application maintenance timers and coalescing; one execution slot serializes passes, so slow maintenance can delay other jobs. Stop the worker before closing queue and application databases.

  Document attempt-level email outcomes, retained personal data after purge failure, sensitive queue backups, and the drained grouped rollout with paired SQLite backup/restore checks. Deploy web, worker and CLI together only after all old work drains; rollback requires proven compatibility or explicit approval for paired restore and loss of later writes.

- e55c292: Upgrade OpenWorkflow to 0.11.0 with single-slot child-workflow regression coverage. Route worker engine diagnostics through structured logging and expose explicit queue connection shutdown. Existing appointment workflows and maintenance timers are unchanged in this step.
- ae10e12: Let hosts add an optional note of up to 500 characters when declining an individual appointment request. Save it with the decline action and show it in decline emails and appointment details without changing the general note or bulk decline behavior. Use concise note dialogs and consistent live character counts across notes and reasons, retaining existing limits and requiredness.
- 6c2a8ba: Ask CalDAV and Nextcloud servers to expand recurring events within the requested busy-time window, matching Google's existing server-expanded approach. Remove local recurrence processing, preserve each returned occurrence's actual bounds, and reject unexpanded or malformed data without replacing the last good busy mirror. Pin date-only and floating-time query selection to UTC to match their existing import interpretation. Read validated occurrence fields directly so component-marker text in descriptions cannot change busy times or hide cancellation/free status. Outgoing appointment invitations and calendar publishing are unchanged.
- 2616f16: Keep provider authentication and calendar discovery failures separate from failures to save their status. A failed status write now escapes without falsely marking the provider as broken.
- ff6174e: Show provider authentication test feedback, including errors, separately from recorded provider health. A test timeout or unreachable worker no longer labels the provider down.
- 4310ec9: Prune duplicate worker workflow and email-dispatch tests while retaining their regression protection in existing application-level tests. Preserve fifth-attempt recovery, independent recipient budgets, restart behavior, and email routing and attachment checks. This is a test-only refinement; production behavior is unchanged.
- c63c735: Serve the generated editor configuration schema publicly at /schema.json from the deployed package. Require cache revalidation and expose only the schema, never loaded configuration or credentials.
- 4e369d5: Show hosts saved appointment details with a clear warning when a meeting type is no longer configured. Read partial snapshots as display information rather than configuration, keep unavailable controls and calendar links hidden, and return a deliberate not-found response for unusable historical details without changing guest access.
- 3111532: Avoid logging raw SMTP rejection messages, which may contain recipient addresses or message content. Log the numeric SMTP failure status when available while preserving the detailed failure reason for the caller.
- 1ece98a: Preserve the actual SMTP attempt time when retrying a status write, without resending a checkpointed email. Keep the existing last-recorded status policy: a delayed success may replace a newer failure and move the recorded timestamp backwards.
- 7b0ab88: Show SMTP test feedback, including error messages, separately from recorded mail-server health. A failed test or timed-out wait no longer labels the SMTP server down.
- 1a3b4d0: Use Kysely's native SQLite connection handling so concurrent queries cannot accidentally join another request's transaction or be undone by its rollback.
- 1a1232b: Add an explicit SQLite write transaction for short read-modify-write operations. Reserve write access before reading so another process cannot invalidate the transaction's snapshot before its update. Existing callers remain unchanged.
- f95fdf9: Enforce the existing CalDAV REPORT text ceiling while reading the response, cancel oversized bodies, and document the retained text and XML nesting limits.
- bcbad69: Add a remembered System/Dark/Light switch on the homepage and immediately before sign-out in the admin navigation. Keep the chosen palette across all pages, including pages without the switch, and follow the device theme automatically in System mode. Make the admin navigation and sign-out controls icon-only while retaining accessible labels. The dashboard's arrow-up-left link returns to the homepage; other admin pages keep their calendar link back to the dashboard.
- 12a4db3: Accept Unicode line and paragraph separators in CalDAV event text and strengthen the expanded-calendar reader's folding, parameter, and raw-value regression contracts.
- 7ffbd7c: Add an optional appointment video-generation request for durable reconciliation. A missing request follows configured attachment rules; `generate` and `suppress` explicitly override them. Existing URLs and revisions remain unchanged.
- 1516fcc: Use a shared video-adapter contract selected from the configured service. Keep Google conference operations behind its adapter using generic calendar-event I/O, and validate Nextcloud room identities for lookup and deletion.
- 0375b8d: Request, remove or cancel a video link directly from the appointment menu without confirmation dialogs. Show manual and automatic link requests inline until a link is selected, preserve that indication across page refreshes, and display failed saves without hiding the existing choice. Keep normal URL editing consistent with the other detail editors.
- 156141a: Resolve booking and rescheduling form destinations and guest-field editability in server loaders. Keep the shared wizard focused on rendering the supplied behavior instead of inferring it from host or guest identity, without changing routes, permissions or submission feedback.
- 20292ba: Change `when_jobs_total` status label values from `success`/`failure` to `returned`/`escaped`. These count handler executions, including durable suspension as an escape, not terminal workflow outcomes. Keep existing active-handler gauge and execution-duration semantics, and leave physical SMTP and calendar counter labels unchanged.

  Use the native public SDK workflow handler type without a handwritten argument alias or cast.

## 0.0.12

## 0.0.11

## 0.0.10

### Patch Changes

- 85bb53a: caldav calendars were not skipping 'free' (not busy) events when calculating availability. this fix aligns expectations that were correct in google calendar event handling
- 04c6877: better support for caldav all day busy events when calculating availability
- db9db00: suppress host calendar provider notifications avoiding duplicate confirmations

## 0.0.9

## 0.0.8
