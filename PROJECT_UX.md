# UX Refresh: Vertical Day View Timeline

## Objective

Replace the overwhelming list of available time slots on the scheduling page with an intuitive, vertical "day view" timeline. This redesign will be mobile-first but fully responsive on desktop, and will clearly differentiate between available times, busy meetings, and outside-working-hours.

## Key Files & Context

- `src/routes/(app)/schedule/[slug]/+page.server.ts`: Responsible for computing the available slots and gathering existing appointments and remote busy blocks.
- `src/routes/(app)/schedule/[slug]/+page.svelte`: The main booking UI that renders the calendar and time selections.
- `src/lib/server/availability/calc.ts`: Contains the slot generation logic, which we can leverage to also export the merged busy blocks and working hour windows.

## Implementation Steps

### 1. Enhance Server Data Payload (`+page.server.ts`)

Currently, the server only sends the array of valid slots grouped by date (`slotsByDate`). For the client to render a complete timeline, it needs to know:

- **`busyBlocks`:** An array of merged intervals (start/end ISO strings) representing existing appointments and remote calendar busy times.
- **`workingWindows`:** An array of base availability intervals (start/end ISO strings) representing the host's actual working hours before any buffers or slot validations are applied.
- The server will serialize and append these to the `PageServerLoad` return object.

### 2. Timeline Boundaries & Math (`+page.svelte`)

- When a `viewDate` is selected, the UI will iterate over `workingWindows` for that specific day, converting them to the booker's `localTz`.
- To create the **Compact View**, the timeline's Y-axis will be constrained by the earliest working hour and latest working hour of that day (plus a small visual padding, e.g., 1 hour before and after).
- The timeline will use absolute CSS positioning: `top` is calculated as a percentage of the way from `timelineStart` to `timelineEnd`.

### 3. Visual Representation

- **Background Grid:** The timeline container will default to a diagonal CSS hatch pattern (indicating outside working hours or unavailable blocks).
- **Working Windows:** Rendered as white/solid distinct blocks sitting on top of the hatch pattern to indicate "open for business".
- **Busy Blocks:** Rendered as solid gray/colored blocks with a "Busy" label sitting on top of the working windows, using the `busyBlocks` array.

### 4. Interactive "Snap-to-Grid" Slots

- The existing `daySlots` array contains the exact starting instants for valid bookings.
- Iterate over `daySlots` and render an invisible or lightly outlined `button` for each, positioned exactly on the timeline with a `height` corresponding to the event's `duration`.
- On `:hover`, the slot preview becomes solid or highlighted. On `click`, it locks the `viewSlot` selection.

### 5. Form Rendering

- When a slot is selected, instead of entirely replacing the time selection UI, the booking form (`<div class="booking-form">`) will render directly _below_ the vertical timeline grid on mobile, and side-by-side or below on desktop depending on space.

## Verification & Testing

- **Visual Checks:** Confirm the CSS hatch pattern accurately reflects gaps in the host's working hours across different timezones. Confirm "Busy" blocks align perfectly with the timeline labels.
- **Mobile Responsiveness:** Ensure the vertical timeline is highly legible and scrollable on narrow viewports without breaking the surrounding layout.
- **Test Suite:** Run existing `bun test` and Playwright `bun run test:e2e` tests to ensure the availability logic hasn't been structurally broken by the newly serialized payloads.
