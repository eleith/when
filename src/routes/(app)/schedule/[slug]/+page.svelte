<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';
	import { Calendar } from 'bits-ui';
	import { CalendarDate, type DateValue } from '@internationalized/date';

	let { data, form } = $props();

	let localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

	let allSlots = $derived(Object.values(data.slotsByDate as Record<string, string[]>).flat());
	let availableDates = $derived.by(() => {
		const set = new Set<string>();
		for (const iso of allSlots) {
			set.add(Temporal.Instant.from(iso).toZonedDateTimeISO(localTz).toPlainDate().toString());
		}
		return set;
	});
	let firstDate = $derived([...availableDates].sort()[0] ?? null);

	// User-controlled state — initialized in $effect below
	let viewSlot = $state<string | null>(null);
	let viewDate = $state<string | null>(null);
	let _init = $state(false);

	function dateToStr(d: DateValue): string {
		return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
	}

	function strToCalendarDate(key: string): CalendarDate {
		return new CalendarDate(Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10)));
	}

	let calendarValue = $derived(viewDate ? strToCalendarDate(viewDate) : undefined);

	$effect(() => {
		if (_init) return;
		viewSlot = data.selectedSlot;
		viewDate = data.selectedSlot?.slice(0, 10) ?? firstDate;
		_init = true;
	});

	const todayKey = new Date().toISOString().slice(0, 10);
	let daySlots = $derived.by(() => {
		if (!viewDate) return [];
		return allSlots
			.filter(
				(iso: string) =>
					Temporal.Instant.from(iso).toZonedDateTimeISO(localTz).toPlainDate().toString() ===
					viewDate
			)
			.sort();
	});

	// ---- calendar helpers ----
	function isDateUnavailable(date: DateValue): boolean {
		return !availableDates.has(dateToStr(date));
	}

	function isDateDisabled(date: DateValue): boolean {
		return dateToStr(date) < todayKey;
	}

	// ---- actions ----
	const MOBILE_MQ = '(max-width: 768px)';

	let timelineEl = $state<HTMLElement | null>(null);
	let formEl = $state<HTMLElement | null>(null);

	function scrollTo(el: HTMLElement | null) {
		if (!el || !window.matchMedia(MOBILE_MQ).matches) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function onDateChange(date: DateValue | undefined) {
		if (!date) return;
		const key = dateToStr(date);
		if (!availableDates.has(key)) return;
		viewDate = key;
		if (viewSlot && !viewSlot.startsWith(key)) {
			viewSlot = null;
			history.replaceState({}, '', '?');
		}
		scrollTo(timelineEl);
	}

	function selectSlot(iso: string) {
		viewSlot = iso;
		viewDate = iso.slice(0, 10);
		history.replaceState({}, '', `?slot=${encodeURIComponent(iso)}`);
		scrollTo(formEl);
	}

	// ---- timeline day view ----
	let timeline = $derived.by(() => {
		if (!viewDate) return null;

		const dateObj = Temporal.PlainDate.from(viewDate);
		const startOfDay = dateObj.toZonedDateTime(localTz).toInstant();
		const endOfDay = dateObj.add({ days: 1 }).toZonedDateTime(localTz).toInstant();

		const dayWindows = (data.workingWindows as { start: string; end: string }[])
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

		const busy = (data.busyBlocks as { start: string; end: string }[])
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

		const buffers = (data.busyBlocks as { start: string; end: string }[])
			.map((b) => {
				const start = Temporal.Instant.from(b.start).subtract({
					minutes: data.eventType.buffer_before ?? 0
				});
				const end = Temporal.Instant.from(b.end).add({ minutes: data.eventType.buffer_after ?? 0 });
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
			const end = start.add({ minutes: data.eventType.duration });
			return {
				iso,
				time: fmtTime(iso),
				top: toPercent(start),
				height: toPercent(end) - toPercent(start)
			};
		});

		const labels = [];
		let current = viewStart
			.toZonedDateTimeISO(localTz)
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
			minutes: (data.eventType.minimum_notice ?? 0) + (data.eventType.buffer_before ?? 0)
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

	// ---- timeline interaction ----
	let hoverY = $state<number | null>(null);

	function handleTimelineMove(e: MouseEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		hoverY = ((e.clientY - rect.top) / rect.height) * 100;
	}

	function handleTimelineLeave() {
		hoverY = null;
	}

	function handleTimelineClick(e: MouseEvent | TouchEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : (e as MouseEvent).clientY;
		const clickY = ((clientY - rect.top) / rect.height) * 100;

		let best = null;
		let minDiff = Infinity;

		for (const s of timeline?.slots || []) {
			const diff = Math.abs(s.top - clickY);
			if (diff < minDiff) {
				minDiff = diff;
				best = s;
			}
		}

		if (best && minDiff < 10) {
			selectSlot(best.iso);
		}
	}

	// ---- formatting ----
	function fmtSlot(iso: string): string {
		try {
			const instant = Temporal.Instant.from(iso);
			return instant.toZonedDateTimeISO(localTz).toLocaleString(undefined, {
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
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
				.toZonedDateTimeISO(localTz)
				.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
		} catch {
			return iso;
		}
	}
</script>

<svelte:head>
	<title>{data.eventType.name} — {data.user.name}</title>
</svelte:head>

<header class="page-banner">
	<a href="/" class="banner-link">
		{#if data.user.branding?.avatar_url || data.user.branding?.logo_url}
			<img
				src={data.user.branding?.avatar_url || data.user.branding?.logo_url}
				alt={data.user.name}
				class="banner-avatar"
			/>
		{/if}
		<div class="banner-text">
			<span class="banner-title">{data.user.branding?.page_title || data.user.name}</span>
			{#if data.user.branding?.descriptionHtml}
				<div class="banner-desc">{@html data.user.branding.descriptionHtml}</div>
			{/if}
		</div>
	</a>
</header>

<div class="booking">
	<header class="booking-header">
		{#if data.reschedule}
			<p class="reschedule-badge">Reschedule</p>
		{/if}
		<h1 class="event-name">{data.eventType.name}</h1>
		<p class="event-meta">
			{data.eventType.duration} min
			{#if data.eventType.description}
				&middot; {data.eventType.description}{/if}
		</p>
	</header>

	{#if availableDates.size === 0}
		<p class="empty">No availability in the near future.</p>
	{:else}
		<div class="booking-body">
				<div class="calendar-panel">
					<p class="step-label">1. Pick a day</p>
					<Calendar.Root
						type="single"
						fixedWeeks
						weekdayFormat="short"
						isDateUnavailable={isDateUnavailable}
						isDateDisabled={isDateDisabled}
						value={calendarValue}
						onValueChange={onDateChange}
					>
						{#snippet children({ months, weekdays })}
							<Calendar.Header class="cal-header">
								<Calendar.PrevButton class="cal-nav-btn">&lsaquo;</Calendar.PrevButton>
								<Calendar.Heading class="cal-heading" />
								<Calendar.NextButton class="cal-nav-btn">&rsaquo;</Calendar.NextButton>
							</Calendar.Header>
							<Calendar.Grid class="cal-grid">
								<Calendar.GridHead>
									<Calendar.GridRow class="cal-weekdays">
										{#each weekdays as day}
											<Calendar.HeadCell class="cal-weekday">{day.slice(0, 2)}</Calendar.HeadCell>
										{/each}
									</Calendar.GridRow>
								</Calendar.GridHead>
								<Calendar.GridBody>
									{#each months as month}
										{#each month.weeks as weekDates}
											<Calendar.GridRow class="cal-row">
												{#each weekDates as date}
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

					<p class="tz-note">Times shown in {localTz.replace(/_/g, ' ')}</p>
				</div>

			{#if viewDate && timeline}
				<div class="timeline-container" bind:this={timelineEl}>
						<p class="step-label">2. Pick a time</p>
						<h2 class="slots-date">{fmtDate(viewDate)}</h2>
						<div class="timeline-scroll">
							<div
								class="timeline"
								style:height="{(timeline.totalMs / 3600000) * 96}px"
							>
								{#each timeline.labels as { label, top }}
									<div class="timeline-label" style:top="{top}%">{label}</div>
									<div class="timeline-gridline" style:top="{top}%"></div>
								{/each}

								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="timeline-track"
									onclick={handleTimelineClick}
									onmousemove={handleTimelineMove}
									onmouseleave={handleTimelineLeave}
								>
									<div class="hatch-bg"></div>

									{#each timeline.working as w}
										<div
											class="working-window"
											style:top="{w.top}%"
											style:height="{w.height}%"
										></div>
									{/each}

									{#if timeline.past}
										<div
											class="buffer-block"
											style:top="{timeline.past.top}%"
											style:height="{timeline.past.height}%"
										></div>
									{/if}

									{#each timeline.buffers as b}
										<div
											class="buffer-block"
											style:top="{b.top}%"
											style:height="{b.height}%"
										></div>
									{/each}

									{#each timeline.busy as b}
										<div class="busy-block" style:top="{b.top}%" style:height="{b.height}%">
											<span class="busy-text">Busy</span>
										</div>
									{/each}

									{#if viewSlot}
										{@const s = timeline.slots.find((s) => s.iso === viewSlot)}
										{#if s}
											<div
												class="slot-block selected"
												style:top="{s.top}%"
												style:height="{s.height}%"
											>
												<span class="slot-text">{s.time}</span>
											</div>
										{/if}
									{/if}

									{#if hoverY !== null}
										<div class="timeline-cursor" style:top="{hoverY}%"></div>
									{/if}
								</div>
							</div>
						</div>
					</div>
			{:else}
				<div class="timeline-container empty-state" bind:this={timelineEl}>
					<p class="step-label">2. Pick a time</p>
					<p>Select a highlighted date to see available times.</p>
				</div>
			{/if}

			<div class="booking-form" bind:this={formEl}>
				<p class="step-label">3. Fill in your details</p>
				{#if viewSlot}
						<p class="confirmed-slot">{fmtSlot(viewSlot)}</p>

						{#if form?.error}
							<p class="form-error" role="alert">{form.error}</p>
						{/if}

						<form method="POST" action={data.reschedule ? '?/reschedule' : '?/book'}>
							<input type="hidden" name="slot" value={viewSlot} />
							{#if data.reschedule}
								<input type="hidden" name="reschedule_id" value={data.reschedule.id} />
								<input type="hidden" name="token" value={data.token} />
							{/if}

							<div class="field">
								<label for="name">What is your name?</label>
								<input
									id="name"
									name="name"
									required
									autocomplete="name"
									value={data.reschedule?.name ?? ''}
								/>
							</div>

							<div class="field">
								<label for="email">What is your email?</label>
								<input
									id="email"
									name="email"
									type="email"
									required
									autocomplete="email"
									value={data.reschedule?.email ?? ''}
								/>
							</div>

							{#if data.eventType.location?.mode === 'fixed'}
								<div class="field">
									<span class="field-label">Where</span>
									<p class="location-display">{data.eventType.location.fixed}</p>
								</div>
							{:else if data.eventType.location?.mode === 'guest_proposes'}
								<div class="field">
									<label for="location">Where should we meet?</label>
									<input id="location" name="location" required />
								</div>
							{:else if data.eventType.location?.mode === 'choice'}
								<div class="field">
									<label for="location">Where should we meet?</label>
									<select id="location" name="location" required>
										{#each data.eventType.location.choices as choice (choice)}
											<option value={choice}>{choice}</option>
										{/each}
									</select>
								</div>
							{/if}

							<div class="field">
								<label for="notes">Anything else?</label>
								<textarea id="notes" name="notes" rows="3"></textarea>
							</div>

							<button type="submit" class="submit-btn">
								{data.reschedule ? 'Reschedule' : 'Book'}
							</button>
						</form>
				{:else}
					<div class="form-placeholder">
						<p>Select a time on the timeline to continue</p>
					</div>
				{/if}
				</div>
		</div>
	{/if}
</div>

<style>
	.booking {
		max-width: 960px;
		margin: 0 auto;
		padding: var(--space-8) var(--space-6) var(--space-10);
		color: var(--text);
	}

	.booking-header {
		margin-bottom: var(--space-7);
	}

	.reschedule-badge {
		display: inline-block;
		background: var(--accent);
		color: var(--text-on-accent);
		font-size: var(--font-size-xs);
		font-weight: 600;
		padding: var(--space-1) var(--space-4);
		border-radius: var(--radius-pill);
		margin-bottom: var(--space-3);
	}

	.event-name {
		font-size: var(--font-size-2xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
	}

	.event-meta {
		color: var(--text-muted);
		margin: 0;
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: var(--space-9) 0;
	}

	/* ---- step labels ---- */
	.step-label {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-disabled);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 var(--space-4);
	}

	/* ---- two-column layout ---- */
	.booking-body {
		display: flex;
		gap: var(--space-7);
		align-items: flex-start;
	}

	.calendar-panel {
		flex-shrink: 0;
		width: 250px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-6);
	}

	.timeline-container {
		flex: 1;
		min-width: 0;
	}

	.booking-form {
		flex: 0 0 270px;
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

	.calendar-panel :global(.cal-nav-btn) {
		background: none;
		border: none;
		font-size: var(--font-size-2xl);
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

	.calendar-panel :global(.cal-day:not([data-unavailable]):not([data-disabled]):not([data-selected])) {
		font-weight: 600;
		color: var(--accent);
	}

	.calendar-panel :global(.cal-day:not([data-unavailable]):not([data-disabled]):not([data-selected]):hover) {
		background: var(--surface-accent);
	}

	.calendar-panel :global(.cal-day[data-today]:not([data-selected])::after) {
		content: '';
		position: absolute;
		bottom: var(--space-1);
		left: 50%;
		transform: translateX(-50%);
		width: var(--space-2);
		height: var(--space-2);
		border-radius: 50%;
		background: var(--accent);
	}

	.calendar-panel :global(.cal-day[data-selected]) {
		background: var(--accent);
		color: var(--text-on-accent);
	}

	.calendar-panel :global(.cal-day[data-selected][data-today]::after) {
		background: var(--text-on-accent);
	}

	.calendar-panel :global(.cal-day[data-outside-month]) {
		visibility: hidden;
	}

	.tz-note {
		margin: var(--space-5) 0 0;
		font-size: var(--font-size-xs);
		color: var(--text-disabled);
		text-align: center;
	}

	/* ---- timeline day view ---- */
	.timeline-container {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-7);
	}

	.slots-date {
		font-size: var(--font-size-lg);
		font-weight: 600;
		margin: 0 0 var(--space-5);
	}

	.timeline-scroll {
		position: relative;
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
		background: var(--surface-accent);
		border: 1px solid var(--accent);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: flex-start;
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--accent);
		z-index: 5;
		transition: all var(--transition);
		pointer-events: none;
	}

	.timeline-cursor {
		position: absolute;
		left: 0;
		right: 0;
		height: 1px;
		background: var(--accent);
		z-index: 7;
		pointer-events: none;
	}

	.slot-text {
		font-weight: 600;
	}

	.empty-state {
		text-align: center;
		color: var(--text-muted);
		padding: var(--space-9) var(--space-7);
	}

	/* ---- booking form ---- */
	.booking-form {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-7);
	}

	.confirmed-slot {
		font-size: var(--font-size-lg);
		font-weight: 600;
		margin: 0 0 var(--space-6);
	}

	.form-error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		font-size: var(--font-size-base);
		margin-bottom: var(--space-6);
	}

	.field {
		margin-bottom: var(--space-5);
	}

	.field label,
	.field-label {
		display: block;
		font-size: var(--font-size-sm);
		font-weight: 600;
		margin-bottom: var(--space-2);
		color: var(--text-secondary);
	}

	.field input,
	.field select,
	.field textarea {
		width: 100%;
		padding: var(--space-4) var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		box-sizing: border-box;
		transition: border-color var(--transition);
		background: var(--surface);
		color: var(--text);
	}

	.field input:focus,
	.field select:focus,
	.field textarea:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: var(--shadow-focus);
	}

	.location-display {
		color: var(--text-muted);
		font-size: var(--font-size-md);
		margin: 0;
	}

	.submit-btn {
		width: 100%;
		padding: var(--space-4) var(--space-6);
		background: var(--accent);
		color: var(--text-on-accent);
		border: none;
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--transition);
		margin-top: var(--space-2);
	}

	.submit-btn:hover {
		opacity: 0.9;
	}

	/* ---- form placeholder ---- */
	.form-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		color: var(--text-disabled);
		font-size: var(--font-size-sm);
		padding: var(--space-9) var(--space-7);
		min-height: 200px;
	}

	/* ---- responsive ---- */
	@media (max-width: 768px) {
		.booking-body {
			flex-direction: column;
		}

		.calendar-panel,
		.booking-form,
		.timeline-container {
			width: 100%;
			flex: 0 0 auto;
		}

		.calendar-panel,
		.timeline-container,
		.booking-form {
			scroll-margin-top: var(--space-5);
		}
	}

	/* ---- page banner (full-width) ---- */
	.page-banner {
		width: 100%;
		border-bottom: 1px solid var(--border);
		padding: var(--space-5) var(--space-7);
	}

	.banner-link {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		text-decoration: none;
		color: inherit;
		max-width: 960px;
	}

	.banner-link:hover .banner-title {
		opacity: 0.8;
	}

	.banner-avatar {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
	}

	.banner-text {
		min-width: 0;
	}

	.banner-title {
		font-size: var(--font-size-md);
		font-weight: 700;
		transition: opacity var(--transition);
	}

	.banner-desc {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin-top: var(--space-1);
	}

	.banner-desc :global(p) {
		margin: 0;
	}
</style>
