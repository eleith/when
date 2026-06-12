<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Temporal } from '@js-temporal/polyfill';
	import { Calendar, Dialog } from 'bits-ui';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconCaretRight from 'virtual:icons/ph/caret-right';
	import IconGlobe from 'virtual:icons/ph/globe';

	interface EventTypeShape {
		duration: number;
		buffer_before?: number | null;
		buffer_after?: number | null;
		minimum_notice?: number | null;
	}

	interface Props {
		slotsByDate: Record<string, string[]>;
		workingWindows: { start: string; end: string }[];
		busyBlocks: { start: string; end: string }[];
		eventType: EventTypeShape;
		selectedSlot: string | null;
		viewDate?: string | null;
		userTz?: string;
		originalSlot?: string | null;
	}

	let {
		slotsByDate,
		workingWindows,
		busyBlocks,
		eventType,
		selectedSlot = $bindable(),
		viewDate = $bindable(null),
		userTz = $bindable(Intl.DateTimeFormat().resolvedOptions().timeZone),
		originalSlot = null
	}: Props = $props();

	const ALL_TIMEZONES = Intl.supportedValuesOf('timeZone');

	function getTzOffset(tz: string): string {
		try {
			const fmt = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' });
			const parts = fmt.formatToParts(new Date());
			return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
		} catch {
			return '';
		}
	}

	type TzInfo = { city: string; offset: string; label: string; haystack: string };
	const TZ_INFO = new SvelteMap<string, TzInfo>();
	for (const tz of ALL_TIMEZONES) {
		const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
		const offset = getTzOffset(tz);
		const label = offset ? `${city} · ${offset}` : city;
		const haystack = `${tz} ${city} ${offset}`.toLowerCase();
		TZ_INFO.set(tz, { city, offset, label, haystack });
	}

	function fmtTzShort(tz: string): string {
		return TZ_INFO.get(tz)?.label ?? tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
	}

	let tzPickerOpen = $state(false);
	let tzSearch = $state('');
	let tzSearchInput = $state<HTMLInputElement | null>(null);
	let tzListEl = $state<HTMLUListElement | null>(null);

	let filteredTimezones = $derived.by(() => {
		const q = tzSearch.trim().toLowerCase();
		if (!q) return ALL_TIMEZONES;
		return ALL_TIMEZONES.filter((tz) => TZ_INFO.get(tz)?.haystack.includes(q));
	});

	$effect(() => {
		if (!tzPickerOpen) return;
		tick().then(() => {
			tzSearchInput?.focus();
			const selected = tzListEl?.querySelector('.tz-option.selected');
			(selected as HTMLElement | null)?.scrollIntoView({ block: 'center' });
		});
	});

	function selectTimezone(tz: string) {
		userTz = tz;
		tzPickerOpen = false;
		tzSearch = '';
	}

	let allSlots = $derived(Object.values(slotsByDate).flat());
	let availableDates = $derived.by(() => {
		const set = new SvelteSet<string>();
		for (const iso of allSlots) {
			set.add(Temporal.Instant.from(iso).toZonedDateTimeISO(userTz).toPlainDate().toString());
		}
		return set;
	});
	let _init = $state(false);
	$effect(() => {
		if (_init) return;

		if (viewDate == null && selectedSlot) {
			viewDate = selectedSlot.slice(0, 10);
		}
		_init = true;
	});

	function dateToStr(d: DateValue): string {
		return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
	}

	function strToCalendarDate(key: string): CalendarDate {
		return new CalendarDate(
			Number(key.slice(0, 4)),
			Number(key.slice(5, 7)),
			Number(key.slice(8, 10))
		);
	}

	let calendarValue = $derived(viewDate ? strToCalendarDate(viewDate) : undefined);

	const todayKey = new Date().toISOString().slice(0, 10);
	let daySlots = $derived.by(() => {
		if (!viewDate) return [];
		return allSlots
			.filter(
				(iso: string) =>
					Temporal.Instant.from(iso).toZonedDateTimeISO(userTz).toPlainDate().toString() ===
					viewDate
			)
			.sort();
	});

	function isDateUnavailable(date: DateValue): boolean {
		return !availableDates.has(dateToStr(date));
	}

	function isDateDisabled(date: DateValue): boolean {
		return dateToStr(date) < todayKey;
	}

	function onDateChange(date: DateValue | undefined) {
		if (!date) {
			viewDate = null;
			if (selectedSlot) selectedSlot = null;
			return;
		}
		const key = dateToStr(date);
		if (!availableDates.has(key)) return;
		viewDate = key;
		if (selectedSlot && !selectedSlot.startsWith(key)) selectedSlot = null;
	}

	function selectSlot(iso: string) {
		const s = timeline?.slots.find((slot) => slot.iso === iso);
		if (s?.isOriginal) return;
		selectedSlot = iso;
		viewDate = iso.slice(0, 10);
	}

	function clearSlot() {
		selectedSlot = null;
	}

	let timeline = $derived.by(() => {
		if (!viewDate) return null;

		const dateObj = Temporal.PlainDate.from(viewDate);
		const startOfDay = dateObj.toZonedDateTime(userTz).toInstant();
		const endOfDay = dateObj.add({ days: 1 }).toZonedDateTime(userTz).toInstant();

		const dayWindows = workingWindows
			.map((w) => ({
				start: Temporal.Instant.from(w.start),
				end: Temporal.Instant.from(w.end)
			}))
			.filter(
				(w) =>
					Temporal.Instant.compare(w.start, endOfDay) < 0 &&
					Temporal.Instant.compare(w.end, startOfDay) > 0
			);

		if (dayWindows.length === 0) return null;

		let earliest = dayWindows[0].start;
		let latest = dayWindows[0].end;
		for (const w of dayWindows) {
			if (Temporal.Instant.compare(w.start, earliest) < 0) earliest = w.start;
			if (Temporal.Instant.compare(w.end, latest) > 0) latest = w.end;
		}

		let viewStart = earliest.subtract({ hours: 1 });
		if (Temporal.Instant.compare(viewStart, startOfDay) < 0) viewStart = startOfDay;

		let viewEnd = latest.add({ hours: 1 });
		if (Temporal.Instant.compare(viewEnd, endOfDay) > 0) viewEnd = endOfDay;

		const totalMs = Number(viewEnd.epochMilliseconds - viewStart.epochMilliseconds);
		if (totalMs <= 0) return null;

		const toPercent = (inst: Temporal.Instant) => {
			const ms = Number(inst.epochMilliseconds - viewStart.epochMilliseconds);
			return Math.max(0, Math.min(100, (ms / totalMs) * 100));
		};

		const busy = busyBlocks
			.map((b) => ({
				start: Temporal.Instant.from(b.start),
				end: Temporal.Instant.from(b.end)
			}))
			.filter(
				(b) =>
					Temporal.Instant.compare(b.start, viewEnd) < 0 &&
					Temporal.Instant.compare(b.end, viewStart) > 0
			)
			.map((b) => ({
				top: toPercent(b.start),
				height: toPercent(b.end) - toPercent(b.start)
			}));

		const buffers = busyBlocks
			.map((b) => {
				const start = Temporal.Instant.from(b.start).subtract({
					minutes: eventType.buffer_before ?? 0
				});
				const end = Temporal.Instant.from(b.end).add({ minutes: eventType.buffer_after ?? 0 });
				return { start, end };
			})
			.filter(
				(b) =>
					Temporal.Instant.compare(b.start, viewEnd) < 0 &&
					Temporal.Instant.compare(b.end, viewStart) > 0
			)
			.map((b) => ({
				top: toPercent(b.start),
				height: toPercent(b.end) - toPercent(b.start)
			}));

		const working = dayWindows.map((w) => ({
			top: toPercent(w.start),
			height: toPercent(w.end) - toPercent(w.start)
		}));

		const slots = daySlots.map((iso) => {
			const start = Temporal.Instant.from(iso);
			const end = start.add({ minutes: eventType.duration });
			return {
				iso,
				time: fmtTime(iso),
				top: toPercent(start),
				height: toPercent(end) - toPercent(start),
				isOriginal: iso === originalSlot
			};
		});

		const labels = [];
		let current = viewStart
			.toZonedDateTimeISO(userTz)
			.with({ minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
		if (Temporal.Instant.compare(current.toInstant(), viewStart) < 0) {
			current = current.add({ hours: 1 });
		}
		while (Temporal.Instant.compare(current.toInstant(), viewEnd) < 0) {
			labels.push({
				label: current.toLocaleString(undefined, { hour: 'numeric' }),
				top: toPercent(current.toInstant())
			});
			current = current.add({ hours: 1 });
		}

		let past = null;
		const nowInst = Temporal.Now.instant();
		const noticeInst = nowInst.add({
			minutes: (eventType.minimum_notice ?? 0) + (eventType.buffer_before ?? 0)
		});

		if (Temporal.Instant.compare(noticeInst, viewStart) > 0) {
			if (Temporal.Instant.compare(noticeInst, viewEnd) >= 0) {
				past = { top: 0, height: 100 };
			} else {
				past = { top: 0, height: toPercent(noticeInst) };
			}
		}

		return {
			totalMs,
			working,
			busy,
			buffers,
			past,
			slots,
			labels
		};
	});

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
				clearSlot();
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

	function fmtDate(key: string): string {
		try {
			return Temporal.PlainDate.from(key).toLocaleString(undefined, {
				weekday: 'long',
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return key;
		}
	}

	function fmtTime(iso: string): string {
		try {
			const instant = Temporal.Instant.from(iso);
			return instant
				.toZonedDateTimeISO(userTz)
				.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
		} catch {
			return iso;
		}
	}
</script>

<div class="calendar-panel">
	<Calendar.Root
		type="single"
		fixedWeeks
		weekdayFormat="short"
		{isDateUnavailable}
		{isDateDisabled}
		value={calendarValue}
		onValueChange={onDateChange}
	>
		{#snippet children({ months, weekdays })}
			<Calendar.Header class="cal-header">
				<Calendar.Heading class="cal-heading" />
				<div class="cal-nav">
					<Calendar.PrevButton class="cal-nav-btn"
						><IconCaretLeft aria-hidden="true" /></Calendar.PrevButton
					>
					<Calendar.NextButton class="cal-nav-btn"
						><IconCaretRight aria-hidden="true" /></Calendar.NextButton
					>
				</div>
			</Calendar.Header>
			<Calendar.Grid class="cal-grid">
				<Calendar.GridHead>
					<Calendar.GridRow class="cal-weekdays">
						{#each weekdays as day (day)}
							<Calendar.HeadCell class="cal-weekday">{day.slice(0, 2)}</Calendar.HeadCell>
						{/each}
					</Calendar.GridRow>
				</Calendar.GridHead>
				<Calendar.GridBody>
					{#each months as month (month.value.toString())}
						{#each month.weeks as weekDates, wi (wi)}
							<Calendar.GridRow class="cal-row">
								{#each weekDates as date (date.toString())}
									<Calendar.Cell {date} month={month.value} class="cal-cell">
										<Calendar.Day class="cal-day">{date.day}</Calendar.Day>
									</Calendar.Cell>
								{/each}
							</Calendar.GridRow>
						{/each}
					{/each}
				</Calendar.GridBody>
			</Calendar.Grid>
		{/snippet}
	</Calendar.Root>
</div>

{#if viewDate && timeline}
	<div class="timeline-container">
		<div class="slots-header">
			<h2 class="slots-date">{fmtDate(viewDate)}</h2>
			<button type="button" class="slots-tz" onclick={() => (tzPickerOpen = true)}>
				<IconGlobe class="slots-tz-icon" />
				<span class="slots-tz-text">{fmtTzShort(userTz)}</span>
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

<Dialog.Root bind:open={tzPickerOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="dialog-content tz-dialog">
			<header class="tz-dialog-header">
				<Dialog.Title class="tz-dialog-title">Choose timezone</Dialog.Title>
				<Dialog.Close class="tz-dialog-close" aria-label="Close">&times;</Dialog.Close>
			</header>
			<input
				class="tz-search"
				type="search"
				placeholder="Search timezone or city…"
				bind:value={tzSearch}
				bind:this={tzSearchInput}
				autocomplete="off"
			/>
			<ul class="tz-list" bind:this={tzListEl}>
				{#each filteredTimezones as tz (tz)}
					{@const info = TZ_INFO.get(tz)}
					<li>
						<button
							type="button"
							class="tz-option"
							class:selected={tz === userTz}
							onclick={() => selectTimezone(tz)}
						>
							<span class="tz-option-city">{info?.city ?? tz}</span>
							{#if info?.offset}
								<span class="tz-option-offset">{info.offset}</span>
							{/if}
						</button>
					</li>
				{/each}
				{#if filteredTimezones.length === 0}
					<li class="tz-empty">No matches</li>
				{/if}
			</ul>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.calendar-panel {
		width: 100%;
		max-width: 360px;
		margin: 0 auto;
	}

	.timeline-container {
		width: 100%;
	}

	/* ---- calendar (Bits UI) ---- */
	.calendar-panel :global(.cal-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-4);
	}

	.calendar-panel :global(.cal-heading) {
		font-weight: 600;
		font-size: var(--font-size-md);
		color: var(--text);
	}

	.calendar-panel :global(.cal-nav) {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.calendar-panel :global(.cal-nav-btn) {
		background: none;
		border: none;
		font-size: var(--font-size-xl);
		color: var(--text-muted);
		cursor: pointer;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		line-height: 1;
	}

	.calendar-panel :global(.cal-nav-btn:hover) {
		background: var(--surface-muted);
		color: var(--text);
	}

	.calendar-panel :global(.cal-grid) {
		width: 100%;
		user-select: none;
	}

	.calendar-panel :global(.cal-weekdays) {
		display: flex;
		width: 100%;
	}

	.calendar-panel :global(.cal-weekday) {
		flex: 1;
		text-align: center;
		font-size: var(--font-size-xs);
		color: var(--text-disabled);
		font-weight: 600;
		text-transform: uppercase;
		padding: var(--space-2) 0;
	}

	.calendar-panel :global(.cal-row) {
		display: flex;
		width: 100%;
	}

	.calendar-panel :global(.cal-cell) {
		flex: 1;
		padding: 0;
	}

	.calendar-panel :global(.cal-day) {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		font-size: var(--font-size-sm);
		border: none;
		background: none;
		cursor: pointer;
		border-radius: var(--radius);
		color: var(--text);
		transition: background var(--transition);
		position: relative;
		width: 100%;
	}

	.calendar-panel :global(.cal-day:hover:not([data-disabled]):not([data-selected])) {
		background: var(--surface-muted);
	}

	.calendar-panel :global(.cal-day[data-unavailable]) {
		color: var(--border-strong);
		cursor: default;
	}

	.calendar-panel :global(.cal-day[data-disabled]) {
		color: var(--border-strong);
		cursor: default;
	}

	.calendar-panel
		:global(.cal-day:not([data-unavailable]):not([data-disabled]):not([data-selected])) {
		font-weight: 600;
		color: var(--text);
	}

	.calendar-panel
		:global(.cal-day:not([data-unavailable]):not([data-disabled]):not([data-selected]):hover) {
		background: var(--primary-muted);
	}

	.calendar-panel :global(.cal-day[data-today]:not([data-selected])::after) {
		content: '';
		position: absolute;
		bottom: var(--space-3);
		left: 50%;
		transform: translateX(-50%);
		width: var(--space-2);
		height: var(--space-2);
		border-radius: 50%;
		background: var(--border-strong);
	}

	.calendar-panel :global(.cal-day[data-selected]) {
		background: var(--primary-muted);
		color: var(--primary);
	}

	.calendar-panel :global(.cal-day[data-selected][data-today]::after) {
		background: var(--primary);
	}

	.calendar-panel :global(.cal-day:focus-visible) {
		outline: 2px solid var(--primary);
		outline-offset: -2px;
	}

	.calendar-panel :global(.cal-day[data-outside-month]) {
		visibility: hidden;
	}

	/* ---- timeline day view ---- */
	.slots-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-4);
		margin: 0 0 var(--space-5);
	}

	.slots-date {
		font-size: var(--font-size-lg);
		font-weight: 600;
		margin: 0;
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

	/* ---- timezone dialog ---- */
	:global(.dialog-overlay) {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		z-index: 200;
		animation: tz-fade-in 0.15s ease-out;
	}

	:global(.dialog-content.tz-dialog) {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 201;
		display: flex;
		flex-direction: column;
		max-height: 80vh;
		background: var(--surface);
		border-top: 1px solid var(--border);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		padding: var(--space-5);
		gap: var(--space-4);
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
		animation: tz-slide-up 0.2s ease-out;
	}

	@media (min-width: 769px) {
		:global(.dialog-content.tz-dialog) {
			top: 50%;
			bottom: auto;
			left: 50%;
			right: auto;
			width: 400px;
			max-width: calc(100vw - var(--space-7) * 2);
			max-height: min(70vh, 520px);
			transform: translate(-50%, -50%);
			border: 1px solid var(--border);
			border-radius: var(--radius-md);
			animation: tz-fade-up-desktop 0.2s ease-out;
		}
	}

	@keyframes tz-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes tz-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes tz-fade-up-desktop {
		from {
			transform: translate(-50%, calc(-50% + 8px));
			opacity: 0;
		}
		to {
			transform: translate(-50%, -50%);
			opacity: 1;
		}
	}

	.tz-dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	:global(.tz-dialog-title) {
		margin: 0;
		font-size: var(--font-size-lg);
		font-weight: 600;
	}

	:global(.tz-dialog-close) {
		background: none;
		border: none;
		font-size: var(--font-size-2xl);
		line-height: 1;
		color: var(--text-muted);
		cursor: pointer;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	:global(.tz-dialog-close:hover) {
		background: var(--surface-muted);
		color: var(--text);
	}

	.tz-search {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		background: var(--surface);
		color: var(--text);
		box-sizing: border-box;
	}

	.tz-search:focus {
		outline: none;
		border-color: var(--primary);
		box-shadow: var(--shadow-focus);
	}

	.tz-list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tz-option {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: var(--space-3) var(--space-4);
		font: inherit;
		color: inherit;
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.tz-option:hover {
		background: var(--surface-muted);
	}

	.tz-option.selected {
		background: var(--primary-muted);
		color: var(--primary);
		font-weight: 600;
	}

	.tz-option-city {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tz-option-offset {
		flex-shrink: 0;
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.tz-option.selected .tz-option-offset {
		color: var(--primary);
	}

	.tz-empty {
		padding: var(--space-5);
		text-align: center;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}
</style>
