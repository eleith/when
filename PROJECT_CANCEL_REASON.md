# PROJECT: cancel_reason

Replace the cancel confirmation modal with a reason prompt. The act of providing a
reason *is* the confirmation. The reason is stored on the appointment row, surfaced
in the cancellation emails, and displayed on the cancelled appointment page.

---

## Design decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | New column `cancel_reason` on `appointments` | Follows existing pattern — all lifecycle data lives on the row. Worker receives it automatically via `returningAll()`. |
| 2 | `text`, nullable | Only set on cancel; NULL for all other statuses |
| 3 | `ALTER TABLE ADD COLUMN` migration | SQLite supports this natively; no table rebuild needed |
| 4 | Set in `cancelAppointmentTransition()` | Single point where the CAS UPDATE fires; atomic with status change |
| 5 | Reason is **required** | "The act of recording a reason is the confirmation" — empty submit is rejected |
| 6 | Default value: "I can no longer attend" | Textarea comes pre-filled. User can edit or just hit submit. The submit button is both reason-provider and confirmer in one click. |
| 7 | Max 500 characters | `maxlength="500"` on textarea + server-side validation |
| 8 | Thread to worker via existing `Appointment` snapshot | `enqueueAppointmentEmail` does `returningAll()` after its update, so the row it sends to the worker already carries `cancel_reason`. Zero plumbing to `SendAppointmentEmailInput`, `dispatch`, or templates. |
| 9 | Reason paragraph in both parties' emails | `"Reason: ${reason}"` as a paragraph in the `EmailContent`.rendered via existing `<p>` tags in templates. |
| 10 | Keep email subjects unchanged | Existing subjects like `"Cancelled: 30-min with Acme Scheduling"` stay as-is. |
| 11 | Do NOT append reason to ICS DESCRIPTION | The reason appears in the email body and on the booking page — not in the calendar `.ics` file. |
| 12 | Admin always sees `cancel_reason`; attendees see it if non-null | Attendees can only view their own rows (guarded by cancel_token), so they see it when their own cancellation carries one. |
| 13 | No config changes | The feature is always on; no `config.yaml` or schema toggle. |
| 14 | Keep existing response patterns | Attendee endpoint still redirects (303); admin endpoint still returns JSON `{success}`. The UI handles both via `$state` + `$effect`. |
| 15 | `cancelDialogOpen` uses `$state`, not `$derived` | Must be writable for the kebab-menu `onCancel` callback and the `bind:open` on the Dialog. `$effect` watches `form.success` for admin close. |
| 16 | Remove unused `?cancel=1` query param path | The dialog now opens only via the kebab menu dropdown. The `showCancelModal` flag, the `links.cancel` field, and the `cancel` query param handling in the page server are removed. |

---

## Commit plan

Each commit is self-contained and keeps the test suite green.

### Commit 1 — Database: migration + types

**Purpose:** Add the column to the schema and the TypeScript type. No runtime code uses it yet.

| File | Action |
|---|---|
| `packages/db/src/migrations/0014_cancel_reason.ts` | **New** — `ALTER TABLE ADD COLUMN cancel_reason text` (up), `DROP COLUMN` (down) |
| `packages/db/src/migrations/index.ts` | **Edit** — register `'0014_cancel_reason': cancelReason` |
| `packages/db/src/types.ts` | **Edit** — add `cancel_reason: string \| null` to `AppointmentsTable` (after `cancel_token`, line 38) |

**Tests:** None needed. The type change is structural; all existing tests that call `runMigrations` exercise the new column's existence.

---

### Commit 2 — Core: transition + cancel service

**Purpose:** Accept and persist the reason through the cancel flow. The transition is
the single place the DB UPDATE happens, so wiring it there ensures atomicity.

| File | Action |
|---|---|
| `apps/web/src/lib/server/appointment/transitions.ts` | **Edit** — `cancelAppointmentTransition(db, id)` → `cancelAppointmentTransition(db, id, reason?: string)`. Add `cancel_reason: reason ?? null` to `.set({...})`. |
| `apps/web/src/lib/server/appointment/cancel.ts` | **Edit** — `CancelAppointmentInput` gains `reason?: string`. `cancelAppointment()` passes it to the transition. |
| `apps/web/src/lib/server/appointment/cancel.test.ts` | **Edit** — two new tests |

**New tests in `cancel.test.ts`:**

1. **Reason is persisted when provided**

   Insert a confirmed appointment, cancel with `reason: 'I found a conflict'`,
   assert the persisted row has `cancel_reason === 'I found a conflict'`.

2. **Reason is NULL when not provided**

   Cancel without a reason (valid for programmatic/backcompat paths),
   assert `cancel_reason` is `null`.

3. **Gated cancel does not write reason**

   Cancel a `'declined'` appointment (gated), assert the row is unchanged and
   no reason appears on the row.

---

### Commit 3 — Page servers: form handling + validation

**Purpose:** Extract the reason from the form, validate it, and pass it into
the cancel service. The two endpoints remain distinct: the attendee one
still redirects on success, the admin one still returns JSON.
Also removes the vestigial `showCancelModal` query-param plumbing — the dialog
now opens only via the kebab menu.

| File | Action |
|---|---|
| `apps/web/src/routes/(app)/appointment/[id]/+page.server.ts` | **Edit** — attendee cancel action (line 144): extract reason, validate non-empty + ≤500 chars, pass `reason` to `cancelAppointment()`, keep the existing 303 redirect on success. Also remove `showCancelModal` computation (line 83) and from the return object (line 129). |
| `apps/web/src/routes/(auth)/admin/appointment/[id]/+page.server.ts` | **Edit** — admin cancel action (line 39): same extraction + validation + pass to service, keep `return { success: 'cancelled' }` |

**Validation logic (both actions):**

```ts
const reason = String(form.get('reason') ?? '').trim();
if (!reason) {
  return fail(400, { error: 'Please provide a reason for cancelling.' });
}
if (reason.length > 500) {
  return fail(400, { error: 'Reason must be 500 characters or fewer.' });
}
```

**Success response (unchanged per endpoint):**

| Endpoint | On success | Dialog closes via |
|---|---|---|
| Attendee `?/cancel` | `redirect(303, /appointment/[id]?token=...)` | Page reload — `cancelDialogOpen` resets naturally |
| Admin `/admin/...?/cancel` | `return { success: 'cancelled' }` | `$effect` in commit 4 watches `form.success` |

`fail(400)` returns the error through SvelteKit's `form` prop. The existing error
banner at `+page.svelte:62–66` already renders `form.error` — no UI change needed
for the error case. The dialog stays open with the error displayed above it.

---

### Commit 4 — UI: dialog replacement + cancelled-state display

**Purpose:** Swap the confirmation modal for a reason textarea, and show
the stored reason on the cancelled appointment page.

| File | Action |
|---|---|
| `apps/web/src/routes/(app)/appointment/[id]/+page.svelte` | **Edit** — script block (dialog state `$state` instead of `$derived` + admin-close `$effect`), template lines 360–402 (dialog), lines 130–131 (cancelled banner) |
| `apps/worker/src/links.ts` | **Edit** — remove the `cancel` field from `AppointmentLinks` and its construction (the `?cancel=1` link is unused and no longer needed) |

**Design challenge — two endpoints, two response patterns:**

The same `+page.svelte` renders the cancel dialog for both roles, but the form
posts to different endpoints with different success behaviours:

| Role | Form `action` | On success | On failure |
|---|---|---|---|
| Attendee | `?/cancel` | **303 redirect** → page reloads → `cancelDialogOpen` resets to `false` naturally | `fail(400\|403\|409)` → `form.error` is set, page re-renders in-place |
| Admin | `/admin/appointment/[id]?/cancel` | **JSON `{ success: 'cancelled' }`** → page re-renders in-place → dialog must close programmatically via `form` prop | `fail(400\|409)` → `form.error` is set, page re-renders in-place |

The attendee success path needs nothing extra (redirect handles it). The admin
success path needs `$effect` to watch `form.success` and close the dialog.

**A. Dialog state management (script block, line 18)**

Replace:

```ts
let cancelDialogOpen = $derived(data.showCancelModal);
```

With:

```ts
let cancelDialogOpen = $state(false);

// Close dialog when admin cancel succeeds (JSON response, no redirect)
$effect(() => {
  if (form?.success === 'cancelled') cancelDialogOpen = false;
});
```

Why `$state` instead of `$derived`:
- `$derived` is read-only in Svelte 5 — the kebab menu trigger
  `onCancel={() => (cancelDialogOpen = true)}` must be able to write to it.
- `$state` is writable and still reactive for `bind:open` on the `Dialog.Root`.
- The `$effect` closes the dialog on admin success (the attendee path handles
  this naturally via the 303 redirect, which reloads the page).

**B. Replace dialog content (lines 369–399)**

Old: `<p>` warning + two buttons.  
New:

```svelte
<Dialog.Title>
  {#snippet child({ props: titleProps })}
    <h2 {...titleProps} class="cancel-dialog-title">Why are you cancelling?</h2>
  {/snippet}
</Dialog.Title>

<p class="cancel-dialog-desc">
  {#if data.isAdmin}
    <strong>{data.appointment.attendee_name}</strong> will be notified by email.
    This can't be undone.
  {:else}
    You'll both be notified by email. This can't be undone.
  {/if}
</p>

<textarea
  name="reason"
  class="cancel-reason-input"
  placeholder="I can no longer attend"
  maxlength="500"
  rows="3"
  required
>I can no longer attend</textarea>

<form method="POST" action={...} class="cancel-dialog-actions">
  <input type="hidden" name="token" value={data.token} />
  <button type="submit" class="cancel-confirm-btn">Cancel appointment</button>
  <Dialog.Close>
    {#snippet child({ props: closeProps })}
      <button {...closeProps} type="button" class="cancel-cancel-btn">Keep it</button>
    {/snippet}
  </Dialog.Close>
</form>
```

Key details:
- Textarea is pre-filled with the default `"I can no longer attend"`. The user can
  edit it or submit as-is. One click does both: provides reason + confirms.
- `placeholder` shows the default when the user clears the field.
- `maxlength="500"` enforces client-side; server-side also validated (commit 3).
- Submit button text changes from `"Yes, cancel"` to `"Cancel appointment"`.
- The `action` attribute still switches on `data.isAdmin` (existing line 387 logic
  unchanged).
- On validation failure (`form.error`), the dialog stays open with the error banner
  visible at the top of the page. The user can edit the textarea and retry.

**C. Display reason on cancelled page (after line 130)**

In the `{:else if status === 'cancelled'}` branch of the page header description:

```svelte
{:else if status === 'cancelled'}
  This appointment has been cancelled.
  {#if data.appointment.cancel_reason}
    <span class="cancel-reason-display">Reason: {data.appointment.cancel_reason}</span>
  {/if}
```

This renders for both admin and attendee — the sanitizer (commit 6) ensures
`cancel_reason` is present on the `data` prop.

**D. CSS additions**

```css
.cancel-reason-input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: var(--text-base);
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
  margin-bottom: var(--space-4);
  background: var(--surface);
  color: var(--text);
}

.cancel-reason-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-alpha);
}

.cancel-reason-display {
  display: block;
  margin-top: var(--space-2);
  font-style: italic;
  color: var(--text-muted);
}
```

---

### Commit 5 — Email: surface reason in cancellation email builders

**Purpose:** Include the reason (when present) as a paragraph in the cancellation
emails for both parties. No template changes needed — `paragraphs` already renders
as `<p>` tags in both HTML and plaintext.

| File | Action |
|---|---|
| `apps/worker/src/email/builders/appointment-cancelled-by-attendee.ts` | **Edit** — add reason to both attendee and organizer `paragraphs` |
| `apps/worker/src/email/builders/appointment-cancelled-by-attendee.test.ts` | **Edit** — test with and without reason |
| `apps/worker/src/email/builders/appointment-cancelled-by-organizer.ts` | **Edit** — same |
| `apps/worker/src/email/builders/appointment-cancelled-by-organizer.test.ts` | **Edit** — same |
| `apps/worker/src/email/__fixtures__/appointment.ts` | **Edit** — add `cancel_reason: null` to `sampleAppointment` (no existing test breaks) |

**Helper to keep both builders DRY:**

```ts
function reasonParagraph(a: Appointment): string[] {
  return a.cancel_reason ? [`Reason: ${a.cancel_reason}`] : [];
}
```

**Attendee-cancels builder (`appointment-cancelled-by-attendee.ts`):**

| Recipient | Paragraphs before | Paragraphs after |
|---|---|---|
| Attendee | `[]` | `reasonParagraph(a)` |
| Organizer | `["${name} cancelled this appointment."]` | `["${name} cancelled this appointment.", ...reasonParagraph(a)]` |

**Organizer-cancels builder (`appointment-cancelled-by-organizer.ts`):**

| Recipient | Paragraphs before | Paragraphs after |
|---|---|---|
| Attendee | `[]` | `reasonParagraph(a)` |
| Organizer | `["You cancelled the appointment for ${name}."]` | `["You cancelled the appointment for ${name}.", ...reasonParagraph(a)]` |

**New tests in `appointment-cancelled-by-attendee.test.ts`:**

1. **Reason appears in both messages** — fixture with `cancel_reason: 'Double booked'`.
   Assert `attendee.content.paragraphs` includes `'Reason: Double booked'`.
   Assert `organizer.content.paragraphs` includes both the cancellation notice and
   `'Reason: Double booked'`.

2. **No reason paragraph when null** — uses existing fixture (no change; still passes).
   Assert `attendee.content.paragraphs` is `[]`.
   Assert `organizer.content.paragraphs` is `['Jane Doe <jane@example.com> cancelled this appointment.']`.

**New tests in `appointment-cancelled-by-organizer.test.ts`:**

Mirror of above with organizer-flavoured paragraphs.

---

### Commit 6 — Sanitizer: expose reason to PublicAppointment

**Purpose:** Thread the reason from the DB row to the `data` prop that the Svelte
page receives, so the cancelled-state display (commit 4) actually works.

| File | Action |
|---|---|
| `apps/web/src/lib/server/appointment/sanitize.ts` | **Edit** — add `cancel_reason` to `PublicAppointment` interface and both branches of `toPublicAppointment()` |

**`PublicAppointment` gains:**

```ts
cancel_reason: string | null;
```

(after `status`, before `notifications`)

**`toPublicAppointment()` — both branches:**

```ts
cancel_reason: row.cancel_reason,
```

No filtering needed. Admins always see it; attendees see it on their own rows
(they can only view appointments authenticated by their `cancel_token`).

---

## Files touched (summary)

```
Commit 1 (DB):
  NEW   packages/db/src/migrations/0014_cancel_reason.ts
  EDIT  packages/db/src/migrations/index.ts
  EDIT  packages/db/src/types.ts

Commit 2 (Core):
  EDIT  apps/web/src/lib/server/appointment/transitions.ts
  EDIT  apps/web/src/lib/server/appointment/cancel.ts
  EDIT  apps/web/src/lib/server/appointment/cancel.test.ts

Commit 3 (Page servers):
  EDIT  apps/web/src/routes/(app)/appointment/[id]/+page.server.ts
  EDIT  apps/web/src/routes/(auth)/admin/appointment/[id]/+page.server.ts

Commit 4 (UI + cleanup):
  EDIT  apps/web/src/routes/(app)/appointment/[id]/+page.svelte
  EDIT  apps/worker/src/links.ts

Commit 5 (Email):
  EDIT  apps/worker/src/email/builders/appointment-cancelled-by-attendee.ts
  EDIT  apps/worker/src/email/builders/appointment-cancelled-by-attendee.test.ts
  EDIT  apps/worker/src/email/builders/appointment-cancelled-by-organizer.ts
  EDIT  apps/worker/src/email/builders/appointment-cancelled-by-organizer.test.ts
  EDIT  apps/worker/src/email/__fixtures__/appointment.ts

Commit 6 (Sanitizer):
  EDIT  apps/web/src/lib/server/appointment/sanitize.ts
```

**Total:** 1 new file, 15 edits. No config changes. No template changes.
No `SendAppointmentEmailInput` or workflow plumbing — the worker gets the reason
for free through the existing `appointment` snapshot.

---

## Things intentionally left unchanged

| What | Why |
|---|---|
| `SendAppointmentEmailInput` type | The appointment snapshot in it already carries `cancel_reason` after the DB write |
| `enqueueAppointmentEmail()` signature | Uses `returningAll()` after its update — the returned row includes the new column |
| `dispatch.ts` | Routes `kind` to builders; builders read `i.appointment.cancel_reason` directly |
| Email templates (`email.html.eta`, `email.txt.eta`) | `paragraphs` already renders each string as a `<p>` / line |
| Email subjects | Per decision (3) |
| ICS description (`packages/calendar/src/description.ts`) | Per decision (4) |
| `links.cancel` field | Removed — was never referenced by any email builder. The dialog now opens only via kebab menu. |
| `AppointmentActions.svelte` | No API change — still calls `onCancel()` which sets `cancelDialogOpen = true`. Only the internal state variable changed from `$derived` to `$state`. |
| Config schema / `config.yaml` | Feature is always on |
| Reschedule / decline / accept flows | Only cancellation collects a reason |
