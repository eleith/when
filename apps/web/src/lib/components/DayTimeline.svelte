<script lang="ts">
	import IconGlobe from 'virtual:icons/ph/globe';
	import { formatTzShort, tzCity, tzOffset } from '$lib/datetime';
	import { onDestroy } from 'svelte';
	import {
		slotsOnDate,
		buildDayTimeline,
		isInTimelineBlock,
		isTimelineUnavailable,
		nearestTimelineSlot,
		isDirectSlotHit,
		type TimelineEventType,
		type TimelineSlot
	} from '$lib/appointment';
	import type { AppointmentFlow } from '$lib/appointmentFlow.svelte';
	import TimezoneDialog from './TimezoneDialog.svelte';
	import DurationDialog from './DurationDialog.svelte';

	interface Props {
		flow: AppointmentFlow;
		workingWindows: { start: string; end: string }[];
		busyBlocks: { start: string; end: string }[];
		eventType: TimelineEventType;
		showSlots?: boolean;
		originalSlot?: string | null;
	}

	let {
		flow,
		workingWindows,
		busyBlocks,
		eventType,
		showSlots = false,
		originalSlot = null
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
	const SNAP_HOLD_MS = 90;

	let trackEl = $state<HTMLElement | null>(null);

	function pointToPercent(clientY: number): number {
		if (!trackEl) return 0;
		const rect = trackEl.getBoundingClientRect();
		return ((clientY - rect.top) / rect.height) * 100;
	}

	function createTimelineGestures() {
		let isDragging = $state(false);
		let dragYPercent = $state<number | null>(null);
		let snapYPercent = $state<number | null>(null);
		let suppressTransition = $state(false);
		let snapTimer: ReturnType<typeof setTimeout> | null = null;
		let pointerStartMode: 'on-slot' | 'on-track' | null = null;
		let pointerStartClientY = 0;

		function clearSnap() {
			if (snapTimer) {
				clearTimeout(snapTimer);
				snapTimer = null;
			}
			snapYPercent = null;
			suppressTransition = false;
		}

		function reset() {
			pointerStartMode = null;
			isDragging = false;
			dragYPercent = null;
		}

		return {
			get isDragging() {
				return isDragging;
			},
			get dragYPercent() {
				return dragYPercent;
			},
			get activeYPercent() {
				return isDragging && dragYPercent !== null ? dragYPercent : snapYPercent;
			},
			get suppressTransition() {
				return suppressTransition;
			},
			clearSnap,
			snapTo(percent: number, onSelect: () => void) {
				clearSnap();
				snapYPercent = percent;
				suppressTransition = true;
				onSelect();

				snapTimer = setTimeout(() => {
					snapTimer = null;
					suppressTransition = false;
					snapYPercent = null;
				}, SNAP_HOLD_MS);
			},
			destroy() {
				if (snapTimer) clearTimeout(snapTimer);
			},
			onPointerDown(e: PointerEvent, onSlot: boolean) {
				pointerStartMode = onSlot ? 'on-slot' : 'on-track';
				pointerStartClientY = e.clientY;
				isDragging = false;
				dragYPercent = null;
				if (onSlot && trackEl) {
					trackEl.setPointerCapture(e.pointerId);
				}
			},
			onPointerMove(e: PointerEvent) {
				if (!pointerStartMode) return;
				if (!isDragging && Math.abs(e.clientY - pointerStartClientY) > DRAG_THRESHOLD_PX) {
					isDragging = true;
				}
				if (isDragging && pointerStartMode === 'on-slot') {
					dragYPercent = Math.max(0, Math.min(100, pointToPercent(e.clientY)));
				}
			},
			onPointerUp(
				e: PointerEvent,
				callbacks: {
					onDropSlot: (percent: number) => void;
					onClearSlot: () => void;
					onClickTrack: (percent: number) => void;
				}
			) {
				if (!pointerStartMode) return;
				if (pointerStartMode === 'on-slot') {
					if (isDragging && dragYPercent !== null) {
						callbacks.onDropSlot(dragYPercent);
					} else {
						callbacks.onClearSlot();
					}
				} else if (!isDragging) {
					callbacks.onClickTrack(pointToPercent(e.clientY));
				}
				reset();
			},
			onPointerCancel() {
				reset();
			}
		};
	}

	const gestures = createTimelineGestures();
	onDestroy(gestures.destroy);

	function snapToClick(percent: number) {
		if (!timeline) return;
		const best = nearestTimelineSlot(timeline.slots, percent);
		if (!best || best.isOriginal) return;

		if (isDirectSlotHit(best, percent)) {
			gestures.clearSnap();
			if (selectedSlot !== best.iso) selectSlot(best.iso);
			return;
		}

		gestures.snapTo(percent, () => {
			if (selectedSlot !== best.iso) selectSlot(best.iso);
		});
	}

	function blockTop(slot: TimelineSlot): number {
		if (gestures.activeYPercent === null) return slot.top;
		return Math.max(0, Math.min(100 - slot.height, gestures.activeYPercent - slot.height / 2));
	}

	function handleTrackPointerDown(e: PointerEvent) {
		if (showSlots || !trackEl) return;
		const percent = pointToPercent(e.clientY);
		const current = timeline?.slots.find((s) => s.iso === selectedSlot);
		const onSlot = !!current && percent >= current.top && percent <= current.top + current.height;
		gestures.onPointerDown(e, onSlot);
	}

	function handleTrackPointerMove(e: PointerEvent) {
		gestures.onPointerMove(e);
	}

	function handleTrackPointerUp(e: PointerEvent) {
		gestures.onPointerUp(e, {
			onDropSlot: (percent) => {
				if (!timeline) return;
				const best = nearestTimelineSlot(timeline.slots, percent);
				if (best && !best.isOriginal) selectSlot(best.iso);
			},
			onClearSlot: () => flow.clearSlot(),
			onClickTrack: (percent) => {
				if (timeline && isInTimelineBlock(percent, timeline.working)) {
					snapToClick(percent);
				}
			}
		});
	}

	function handleTrackPointerCancel() {
		gestures.onPointerCancel();
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (!timeline) return;
		const available = timeline.slots.filter((s) => !s.isOriginal);
		if (available.length === 0) return;

		const currentIndex = available.findIndex((s) => s.iso === selectedSlot);

		if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
			e.preventDefault();
			gestures.clearSnap();
			const next = currentIndex < available.length - 1 ? currentIndex + 1 : 0;
			selectSlot(available[next].iso);
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
			e.preventDefault();
			gestures.clearSnap();
			const prev = currentIndex > 0 ? currentIndex - 1 : available.length - 1;
			selectSlot(available[prev].iso);
		} else if (e.key === 'Escape' || e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			gestures.clearSnap();
			flow.clearSlot();
		}
	}
</script>

{#if viewDate && timeline}
	<div class="timeline-container">
		<div class="slots-header">
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
		<div class="timeline-scroll">
			<div class="timeline" style:height="{(timeline.totalMs / 3600000) * 96}px">
				{#each timeline.labels as { label, top } (label)}
					<div class="timeline-label" style:top="{top}%">{label}</div>
					<div class="timeline-gridline" style:top="{top}%"></div>
				{/each}

				<div
					class="timeline-track"
					role="radiogroup"
					aria-label="Available appointment times"
					tabindex="-1"
					bind:this={trackEl}
					onkeydown={handleKeyDown}
					onpointerdown={handleTrackPointerDown}
					onpointermove={handleTrackPointerMove}
					onpointerup={handleTrackPointerUp}
					onpointercancel={handleTrackPointerCancel}
				>
					<div class="closed-bg"></div>

					{#each timeline.working as w, wi (wi)}
						<div class="working-window" style:top="{w.top}%" style:height="{w.height}%"></div>
					{/each}

					{#if timeline.past}
						<div
							class="past-block"
							style:top="{timeline.past.top}%"
							style:height="{timeline.past.height}%"
						></div>
					{/if}

					{#each timeline.buffers as b, bi (bi)}
						<div class="buffer-zone" style:top="{b.top}%" style:height="{b.height}%"></div>
					{/each}

					{#each timeline.busy as b, bi (bi)}
						<div class="busy-block" style:top="{b.top}%" style:height="{b.height}%">
							<span class="busy-text">Busy</span>
						</div>
					{/each}

					{#if showSlots}
						{@render discreteSlots()}
					{:else}
						{@render continuousTrack()}
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

{#snippet discreteSlots()}
	{#if timeline}
		{#each timeline.slots as s (s.iso)}
			{#if !s.isOriginal}
				{@const isSelected = s.iso === selectedSlot}
				<button
					type="button"
					role="radio"
					aria-checked={isSelected}
					class="slot-btn"
					class:selected={isSelected}
					style:top="{s.top}%"
					style:height="{s.height}%"
					onclick={() => selectSlot(s.iso)}
				>
					<span class="slot-text">{s.time} – {s.endTime}</span>
				</button>
			{/if}
		{/each}
	{/if}
{/snippet}

{#snippet continuousTrack()}
	{#if timeline}
		{#each timeline.slots as s (s.iso)}
			{#if !s.isOriginal}
				{@const isSelected = s.iso === selectedSlot}
				<button
					type="button"
					role="radio"
					aria-checked={isSelected}
					class="slot-hit-target"
					class:selected={isSelected}
					style:top="{s.top}%"
					style:height="{s.height}%"
					onclick={() => {
						gestures.clearSnap();
						selectSlot(s.iso);
					}}
				>
					<span class="visually-hidden">{s.time} – {s.endTime}</span>
				</button>
			{/if}
		{/each}

		{#if selectedSlot}
			{@const s = timeline.slots.find((s) => s.iso === selectedSlot)}
			{#if s}
				{@const isSelectedDragging = gestures.isDragging && gestures.dragYPercent !== null}
				{@const preview = isSelectedDragging ? nearestTimelineSlot(timeline.slots, gestures.dragYPercent!) : null}
				{@const overUnavailable = gestures.activeYPercent !== null ? isTimelineUnavailable(timeline, gestures.activeYPercent) : false}
				<div
					class="slot-block selected"
					class:dragging={isSelectedDragging}
					class:no-transition={gestures.suppressTransition || isSelectedDragging}
					class:unavailable={overUnavailable}
					style:top="{blockTop(s)}%"
					style:height="{s.height}%"
					aria-hidden="true"
				>
					<span class="slot-text">
						{preview ? preview.time : s.time} – {preview ? preview.endTime : s.endTime}
					</span>
				</div>
			{/if}
		{/if}
	{/if}
{/snippet}

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
		--timeline-closed: color-mix(in srgb, var(--when-color-text) 5%, var(--color-surface));
		--timeline-hatch: color-mix(in srgb, var(--when-color-text) 20%, var(--color-surface));
	}

	/* ---- timeline toolbar / header ---- */
	.slots-header {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		margin: 0 0 var(--space-6);
		min-height: var(--space-7);
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

	.closed-bg {
		position: absolute;
		inset: 0;
		z-index: 1;
		cursor: default;
	}

	.working-window {
		position: absolute;
		left: 0;
		right: 0;
		background: var(--color-surface);
		z-index: 2;
	}

	.closed-bg,
	.past-block {
		background-color: var(--timeline-closed);
		background-image: repeating-linear-gradient(
			45deg,
			var(--timeline-hatch) 0,
			var(--timeline-hatch) 3px,
			transparent 3px,
			transparent 9px
		);
	}

	.past-block {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 3;
		cursor: default;
	}

	.buffer-zone {
		position: absolute;
		left: var(--space-2);
		right: var(--space-2);
		z-index: 3;
		cursor: not-allowed;
	}

	.busy-block {
		position: absolute;
		left: var(--space-2);
		right: var(--space-2);
		background-color: var(--color-surface-muted);
		background-image: repeating-linear-gradient(
			45deg,
			var(--color-border) 0,
			var(--color-border) 1px,
			transparent 1px,
			transparent 10px
		);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		display: flex;
		justify-content: center;
		align-items: center;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-sm);
		z-index: 4;
		overflow: hidden;
		cursor: not-allowed;
	}

	.busy-text {
		font-weight: 500;
		font-size: var(--font-size-sm);
		color: var(--color-text-disabled);
	}

	.slot-block {
		position: absolute;
		left: var(--space-2);
		right: var(--space-2);
		border-radius: var(--radius-sm);
		display: flex;
		justify-content: center;
		align-items: center;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-sm);
	}

	.slot-block.selected {
		background: var(--color-primary-muted);
		border: 1px solid var(--color-primary-border);
		color: var(--when-color-primary);
		z-index: 5;
		transition:
			top 0.35s cubic-bezier(0.16, 1, 0.3, 1),
			background-color 0.35s ease,
			border-color 0.35s ease,
			color 0.35s ease;
		cursor: grab;
		touch-action: none;
	}

	.slot-block.selected.no-transition {
		transition: none !important;
	}

	.slot-block.selected.dragging {
		transition: none !important;
		opacity: 0.85;
		cursor: grabbing;
		box-shadow: var(--shadow-md, 0 4px 10px rgba(0, 0, 0, 0.15));
		z-index: 6;
	}

	.slot-block.selected.unavailable {
		background: var(--color-danger-bg);
		border-color: var(--color-danger);
		color: var(--color-danger);
	}

	.slot-block.original-appointment {
		background: var(--color-surface-muted);
		border: 1px dashed var(--color-border-strong);
		color: var(--color-text-secondary);
		cursor: not-allowed;
		z-index: 4;
	}

	.slot-text {
		font-weight: 600;
	}

	.empty-state {
		text-align: center;
		color: var(--color-text-muted);
		padding: var(--space-9) var(--space-7);
	}

	/* Accessible hit target for keyboard and screen-readers in continuous mode */
	.slot-hit-target {
		position: absolute;
		left: var(--space-2);
		right: var(--space-2);
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		padding: 0;
		margin: 0;
		cursor: pointer;
		z-index: 4;
	}

	.slot-hit-target:focus-visible {
		outline: none;
		background: var(--color-primary-muted);
		border-color: var(--when-color-primary);
		box-shadow: var(--shadow-focus);
		z-index: 7;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Discrete buttons for show_slots: true */
	.slot-btn {
		position: absolute;
		left: var(--space-2);
		right: var(--space-2);
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
