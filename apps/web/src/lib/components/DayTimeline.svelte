<script lang="ts">
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconGlobe from 'virtual:icons/ph/globe';
	import { formatDate, formatTzShort, tzCity, tzOffset } from '$lib/datetime';
	import { slotsOnDate, buildDayTimeline, type TimelineEventType } from '$lib/appointment';
	import type { AppointmentFlow } from '$lib/appointmentFlow.svelte';
	import TimezoneDialog from './TimezoneDialog.svelte';
	import DurationDialog from './DurationDialog.svelte';

	interface Props {
		flow: AppointmentFlow;
		workingWindows: { start: string; end: string }[];
		busyBlocks: { start: string; end: string }[];
		eventType: TimelineEventType;
		bookingStyle?: 'insert' | 'select';
		originalSlot?: string | null;
		onEditDate?: (() => void) | null;
	}

	let {
		flow,
		workingWindows,
		busyBlocks,
		eventType,
		bookingStyle = 'insert',
		originalSlot = null,
		onEditDate = null
	}: Props = $props();

	// read-only views of the shared flow; all mutations go through flow.* below
	let viewDate = $derived(flow.viewDate);
	let selectedSlot = $derived(flow.selectedSlot);
	let userTz = $derived(flow.userTz);
	let durations = $derived(flow.durations);

	// The picked length is flow state; overlay it onto the static event-type config.
	let liveEventType = $derived({ ...eventType, duration_minutes: flow.duration });

	let tzFull = $derived(formatTzShort(userTz));
	let tzShort = $derived(tzOffset(userTz) || tzCity(userTz));

	let tzOpen = $state(false);
	let durationOpen = $state(false);

	let daySlots = $derived(viewDate ? slotsOnDate(flow.allSlots, viewDate, userTz) : []);

	let timeline = $derived(
		viewDate
			? buildDayTimeline({
					viewDate,
					workingWindows,
					busyBlocks,
					eventType: liveEventType,
					daySlots,
					tz: userTz,
					originalSlot
				})
			: null
	);

	function selectSlot(iso: string) {
		const s = timeline?.slots.find((slot) => slot.iso === iso);
		if (s?.isOriginal) return;
		flow.selectSlot(iso);
	}

	const DRAG_THRESHOLD_PX = 6;

	let trackEl = $state<HTMLElement | null>(null);
	let dragYPercent = $state<number | null>(null);
	let isDragging = $state(false);
	let pointerStartMode: 'on-slot' | 'on-track' | null = null;
	let pointerStartClientY = 0;

	function pointToPercent(clientY: number): number {
		if (!trackEl) return 0;
		const rect = trackEl.getBoundingClientRect();
		return ((clientY - rect.top) / rect.height) * 100;
	}

	function isInBlock(percent: number, blocks?: Array<{ top: number; height: number }>): boolean {
		if (!blocks) return false;
		return blocks.some((b) => percent >= b.top && percent <= b.top + b.height);
	}

	function isUnavailable(percent: number): boolean {
		if (!timeline) return true;
		if (isInBlock(percent, timeline.busy)) return true;
		if (isInBlock(percent, timeline.buffers)) return true;
		if (timeline.past && percent <= timeline.past.top + timeline.past.height) return true;
		return false;
	}

	function nearestSlotAt(percent: number) {
		if (!timeline) return null;
		let best: (typeof timeline.slots)[number] | null = null;
		let minDiff = Infinity;
		for (const s of timeline.slots) {
			const center = s.top + s.height / 2;
			const diff = Math.abs(center - percent);
			if (diff < minDiff) {
				minDiff = diff;
				best = s;
			}
		}
		return best;
	}

	function handleTrackPointerDown(e: PointerEvent) {
		if (bookingStyle === 'select') return;
		if (!trackEl) return;
		const percent = pointToPercent(e.clientY);
		const current = timeline?.slots.find((s) => s.iso === selectedSlot);
		const onSlot = !!current && percent >= current.top && percent <= current.top + current.height;

		pointerStartMode = onSlot ? 'on-slot' : 'on-track';
		pointerStartClientY = e.clientY;
		isDragging = false;
		dragYPercent = null;

		if (onSlot) {
			trackEl.setPointerCapture(e.pointerId);
		}
	}

	function handleTrackPointerMove(e: PointerEvent) {
		if (!pointerStartMode) return;
		const dy = Math.abs(e.clientY - pointerStartClientY);
		if (!isDragging && dy > DRAG_THRESHOLD_PX) {
			isDragging = true;
		}
		if (isDragging && pointerStartMode === 'on-slot') {
			dragYPercent = Math.max(0, Math.min(100, pointToPercent(e.clientY)));
		}
	}

	function handleTrackPointerUp(e: PointerEvent) {
		if (!pointerStartMode) {
			return;
		}

		if (pointerStartMode === 'on-slot') {
			if (isDragging && dragYPercent !== null) {
				if (!isUnavailable(dragYPercent)) {
					const best = nearestSlotAt(dragYPercent);
					if (best && best.iso !== selectedSlot && !best.isOriginal) selectSlot(best.iso);
				}
			} else {
				flow.clearSlot();
			}
		} else {
			if (!isDragging) {
				const percent = pointToPercent(e.clientY);
				if (!isUnavailable(percent)) {
					const best = nearestSlotAt(percent);
					if (best && best.iso !== selectedSlot && !best.isOriginal) selectSlot(best.iso);
				}
			}
		}

		pointerStartMode = null;
		isDragging = false;
		dragYPercent = null;
	}

	function handleTrackPointerCancel() {
		pointerStartMode = null;
		isDragging = false;
		dragYPercent = null;
	}
</script>

{#if viewDate && timeline}
	<div class="timeline-container">
		<div class="slots-header">
			<div class="slots-date-group">
				{#if onEditDate}
					<button
						type="button"
						class="slots-back"
						onclick={onEditDate}
						aria-label="Back to calendar"
					>
						<IconCaretLeft aria-hidden="true" />
					</button>
				{/if}
				<h2 class="slots-date">{formatDate(viewDate)}</h2>
			</div>
			<div class="slots-meta">
				{#if durations.length > 1}
					<button type="button" class="slots-chip" onclick={() => (durationOpen = true)}>
						<span class="slots-chip-text">{flow.duration} min</span>
					</button>
				{:else}
					<span class="slots-static">{flow.duration} min</span>
				{/if}
				<button type="button" class="slots-chip" onclick={() => (tzOpen = true)}>
					<span class="slots-chip-icon"><IconGlobe /></span>
					<span class="slots-chip-text slots-tz-full">{tzFull}</span>
					<span class="slots-chip-text slots-tz-short">{tzShort}</span>
				</button>
			</div>
		</div>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="timeline-scroll" tabindex="0">
			<div class="timeline" style:height="{(timeline.totalMs / 3600000) * 96}px">
				{#each timeline.labels as { label, top } (label)}
					<div class="timeline-label" style:top="{top}%">{label}</div>
					<div class="timeline-gridline" style:top="{top}%"></div>
				{/each}

				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="timeline-track"
					bind:this={trackEl}
					onpointerdown={handleTrackPointerDown}
					onpointermove={handleTrackPointerMove}
					onpointerup={handleTrackPointerUp}
					onpointercancel={handleTrackPointerCancel}
				>
					<div class="hatch-bg"></div>

					{#each timeline.working as w, wi (wi)}
						<div class="working-window" style:top="{w.top}%" style:height="{w.height}%"></div>
					{/each}

					{#if timeline.past}
						<div
							class="buffer-block"
							style:top="{timeline.past.top}%"
							style:height="{timeline.past.height}%"
						></div>
					{/if}

					{#each timeline.buffers as b, bi (bi)}
						<div class="buffer-block" style:top="{b.top}%" style:height="{b.height}%"></div>
					{/each}

					{#each timeline.busy as b, bi (bi)}
						<div class="busy-block" style:top="{b.top}%" style:height="{b.height}%">
							<span class="busy-text">Busy</span>
						</div>
					{/each}

					{#if bookingStyle === 'select'}
						{#each timeline.slots as s (s.iso)}
							{#if !s.isOriginal}
								<button
									type="button"
									class="slot-btn"
									class:selected={s.iso === selectedSlot}
									style:top="{s.top}%"
									style:height="{s.height}%"
									onclick={() => selectSlot(s.iso)}
								>
									<span class="slot-text">{s.time} – {s.endTime}</span>
								</button>
							{/if}
						{/each}
					{:else if selectedSlot}
						{@const s = timeline.slots.find((s) => s.iso === selectedSlot)}
						{#if s}
							{@const preview =
								isDragging && dragYPercent !== null ? nearestSlotAt(dragYPercent) : null}
							{@const overUnavailable =
								isDragging && dragYPercent !== null && isUnavailable(dragYPercent)}
							{@const dragTop =
								isDragging && dragYPercent !== null
									? Math.max(0, Math.min(100 - s.height, dragYPercent - s.height / 2))
									: s.top}
							<div
								class="slot-block selected"
								class:dragging={isDragging}
								class:unavailable={overUnavailable}
								style:top="{dragTop}%"
								style:height="{s.height}%"
							>
								<span class="slot-text">
									{preview ? preview.time : s.time} – {preview ? preview.endTime : s.endTime}
								</span>
							</div>
						{/if}
					{/if}

					{#if timeline.slots.some((s) => s.isOriginal)}
						{@const orig = timeline.slots.find((s) => s.isOriginal)!}
						<div
							class="slot-block original-appointment"
							style:top="{orig.top}%"
							style:height="{orig.height}%"
						>
							<span class="slot-text">{orig.time} (Current)</span>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{:else}
	<div class="timeline-container empty-state">
		<p>Select a highlighted date to see available times.</p>
	</div>
{/if}

<TimezoneDialog bind:open={tzOpen} />
<DurationDialog
	bind:open={durationOpen}
	{durations}
	value={flow.duration}
	onSelect={flow.setDuration}
/>

<style>
	.timeline-container {
		width: 100%;
	}

	/* ---- timeline day view ---- */
	.slots-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
		margin: 0 0 var(--space-7);
	}

	.slots-date-group {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.slots-date {
		font-size: var(--font-size-lg);
		font-weight: 600;
		margin: 0;
	}

	/* caret to return to the calendar — mobile only (desktop has the wizard back button) */
	.slots-back {
		display: none;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		background: none;
		border: none;
		padding: var(--space-1);
		margin-left: calc(var(--space-2) * -1);
		font-size: var(--font-size-xl);
		line-height: 1;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color var(--transition);
	}

	.slots-back:hover {
		color: var(--when-color-text);
	}

	@media (max-width: 768px) {
		.slots-back {
			display: inline-flex;
		}
	}

	.slots-meta {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		flex-shrink: 0;
	}

	.slots-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
		cursor: pointer;
		position: relative;
		z-index: 0;
		transition: color var(--transition);
	}

	.slots-chip::before {
		content: '';
		position: absolute;
		inset: calc(var(--space-4) * -1);
		background: transparent;
		border-radius: var(--radius-sm);
		transition: background var(--transition);
		z-index: -1;
	}

	.slots-chip-text {
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 3px;
	}

	.slots-static {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
	}

	.slots-chip-icon {
		display: inline-flex;
		font-size: var(--font-size-base);
	}

	.slots-chip:hover {
		color: var(--when-color-text);
	}

	.slots-chip:hover::before {
		background: var(--color-surface-muted);
	}

	.slots-tz-short {
		display: none;
	}

	@media (max-width: 768px) {
		.slots-tz-full {
			display: none;
		}

		.slots-tz-short {
			display: inline;
		}
	}

	.timeline-scroll {
		position: relative;
		max-height: 60vh;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: thin;
		scrollbar-color: var(--color-border-strong) transparent;
	}

	.timeline-scroll::-webkit-scrollbar {
		width: 8px;
	}

	.timeline-scroll::-webkit-scrollbar-thumb {
		background: var(--color-border-strong);
		border-radius: 4px;
	}

	.timeline-scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.timeline {
		position: relative;
		margin-left: 60px;
	}

	.timeline-label {
		position: absolute;
		left: -60px;
		width: 50px;
		text-align: right;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: 1;
	}

	.timeline-gridline {
		position: absolute;
		left: 0;
		right: 0;
		height: 1px;
		background: var(--color-border);
		transform: translateY(-50%);
		z-index: 1;
	}

	.timeline-track {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		right: 0;
		border-left: 1px solid var(--color-border-strong);
		z-index: 2;
		cursor: pointer;
		touch-action: pan-y;
	}

	.hatch-bg {
		position: absolute;
		inset: 0;
		background-image: repeating-linear-gradient(
			45deg,
			var(--color-surface-muted) 0,
			var(--color-surface-muted) 2px,
			transparent 2px,
			transparent 8px
		);
		z-index: 1;
		opacity: 0.5;
	}

	.working-window {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--color-surface);
		z-index: 2;
	}

	.busy-block {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--color-border);
		display: flex;
		align-items: flex-start;
		padding: var(--space-1) var(--space-2);
		z-index: 4;
		border-left: 3px solid var(--color-border-strong);
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		overflow: hidden;
	}

	.buffer-block {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 3;
		opacity: 0.5;
		background-image: repeating-linear-gradient(
			45deg,
			var(--color-surface-muted) 0,
			var(--color-surface-muted) 2px,
			transparent 2px,
			transparent 8px
		);
	}

	.busy-text {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.slot-block {
		position: absolute;
		left: var(--space-4);
		right: var(--space-4);
		background: var(--color-primary-muted);
		border: 1px solid var(--color-primary-border);
		border-radius: var(--radius-sm);
		display: flex;
		justify-content: center;
		align-items: center;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--when-color-primary);
		z-index: 5;
		transition: top var(--transition);
		cursor: grab;
		touch-action: none;
	}

	.slot-block.original-appointment {
		background: var(--color-surface-muted);
		border: 1px dashed var(--color-border-strong);
		color: var(--color-text-secondary);
		cursor: not-allowed;
		z-index: 4;
	}

	.slot-block.dragging {
		transition: none;
		opacity: 0.85;
		cursor: grabbing;
		box-shadow: var(--shadow-md, 0 4px 10px rgba(0, 0, 0, 0.15));
	}

	.slot-block.unavailable {
		background: var(--color-danger-bg);
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.slot-text {
		font-weight: 600;
	}

	.empty-state {
		text-align: center;
		color: var(--color-text-muted);
		padding: var(--space-9) var(--space-7);
	}

	.slot-btn {
		position: absolute;
		left: var(--space-4);
		right: var(--space-4);
		background: var(--color-surface);
		border: 1px dashed var(--color-border-strong);
		border-radius: var(--radius-sm);
		display: flex;
		justify-content: center;
		align-items: center;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-secondary);
		z-index: 5;
		cursor: pointer;
		text-align: center;
		transition:
			background-color var(--transition),
			border-color var(--transition),
			color var(--transition),
			transform var(--transition);
	}

	.slot-btn:hover {
		background: var(--color-primary-muted);
		border: 1px solid var(--color-primary-border);
		color: var(--when-color-primary);
		transform: scale(0.99);
	}

	.slot-btn.selected {
		background: var(--color-primary-muted);
		border: 1px solid var(--color-primary-border);
		color: var(--when-color-primary);
	}

	.slot-btn.selected:hover {
		background: var(--color-primary-muted);
		opacity: 0.9;
	}
</style>
