<script lang="ts">
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconGlobe from 'virtual:icons/ph/globe';
	import { formatDate, formatTzShort } from '$lib/datetime';
	import { slotsOnDate, buildDayTimeline, type TimelineEventType } from '$lib/booking';
	import type { BookingFlow } from '$lib/bookingFlow.svelte';
	import TimezoneDialog from './TimezoneDialog.svelte';

	interface Props {
		flow: BookingFlow;
		workingWindows: { start: string; end: string }[];
		busyBlocks: { start: string; end: string }[];
		eventType: TimelineEventType;
		originalSlot?: string | null;
		onEditDate?: (() => void) | null;
	}

	let {
		flow,
		workingWindows,
		busyBlocks,
		eventType,
		originalSlot = null,
		onEditDate = null
	}: Props = $props();

	// read-only views of the shared flow; all mutations go through flow.* below
	let viewDate = $derived(flow.viewDate);
	let selectedSlot = $derived(flow.selectedSlot);
	let userTz = $derived(flow.userTz);

	let tzOpen = $state(false);

	let daySlots = $derived(viewDate ? slotsOnDate(flow.allSlots, viewDate, userTz) : []);

	let timeline = $derived(
		viewDate
			? buildDayTimeline({
					viewDate,
					workingWindows,
					busyBlocks,
					eventType,
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
			<button type="button" class="slots-tz" onclick={() => (tzOpen = true)}>
				<IconGlobe class="slots-tz-icon" />
				<span class="slots-tz-text">{formatTzShort(userTz)}</span>
			</button>
		</div>
		<div class="timeline-scroll">
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

					{#if selectedSlot}
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
								<span class="slot-text">{preview ? preview.time : s.time}</span>
							</div>
						{/if}
					{/if}

					{#if timeline.slots.some((s) => s.isOriginal)}
						{@const orig = timeline.slots.find((s) => s.isOriginal)!}
						<div
							class="slot-block original-booking"
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

<TimezoneDialog bind:open={tzOpen} {flow} />

<style>
	.timeline-container {
		width: 100%;
	}

	/* ---- timeline day view ---- */
	.slots-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
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
		font-size: var(--font-size-xl);
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
		color: var(--text-muted);
		cursor: pointer;
		transition: color var(--transition);
	}

	.slots-back:hover {
		color: var(--text);
	}

	@media (max-width: 768px) {
		.slots-back {
			display: inline-flex;
		}
	}

	.slots-tz {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		font: inherit;
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		white-space: nowrap;
		cursor: pointer;
		position: relative;
		z-index: 0;
		transition: color var(--transition);
	}

	.slots-tz::before {
		content: '';
		position: absolute;
		inset: calc(var(--space-4) * -1);
		background: transparent;
		border-radius: var(--radius-sm);
		transition: background var(--transition);
		z-index: -1;
	}

	.slots-tz-text {
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 3px;
	}

	:global(.slots-tz-icon) {
		font-size: var(--font-size-base);
	}

	.slots-tz:hover {
		color: var(--text);
	}

	.slots-tz:hover::before {
		background: var(--surface-muted);
	}

	.timeline-scroll {
		position: relative;
		max-height: 60vh;
		overflow-y: auto;
		overflow-x: hidden;
		scrollbar-width: thin;
		scrollbar-color: var(--border-strong) transparent;
	}

	.timeline-scroll::-webkit-scrollbar {
		width: 8px;
	}

	.timeline-scroll::-webkit-scrollbar-thumb {
		background: var(--border-strong);
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
		color: var(--text-muted);
		transform: translateY(-50%);
		line-height: 1;
	}

	.timeline-gridline {
		position: absolute;
		left: 0;
		right: 0;
		height: 1px;
		background: var(--border);
		transform: translateY(-50%);
		z-index: 1;
	}

	.timeline-track {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		right: 0;
		border-left: 1px solid var(--border-strong);
		z-index: 2;
		cursor: pointer;
		touch-action: pan-y;
	}

	.hatch-bg {
		position: absolute;
		inset: 0;
		background-image: repeating-linear-gradient(
			45deg,
			var(--surface-muted) 0,
			var(--surface-muted) 2px,
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
		background: var(--surface);
		z-index: 2;
	}

	.busy-block {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--border);
		display: flex;
		align-items: flex-start;
		padding: var(--space-1) var(--space-2);
		z-index: 4;
		border-left: 3px solid var(--border-strong);
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
			var(--surface-muted) 0,
			var(--surface-muted) 2px,
			transparent 2px,
			transparent 8px
		);
	}

	.busy-text {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
	}

	.slot-block {
		position: absolute;
		left: var(--space-4);
		right: var(--space-4);
		background: var(--primary-muted);
		border: 1px solid var(--primary-border);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: flex-start;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--primary);
		z-index: 5;
		transition: top var(--transition);
		cursor: grab;
		touch-action: none;
	}

	.slot-block.original-booking {
		background: var(--surface-muted);
		border: 1px dashed var(--border-strong);
		color: var(--text-secondary);
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
		background: var(--danger-bg);
		border-color: var(--danger);
		color: var(--danger);
	}

	.slot-text {
		font-weight: 600;
	}

	.empty-state {
		text-align: center;
		color: var(--text-muted);
		padding: var(--space-9) var(--space-7);
	}
</style>
