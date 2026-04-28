<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';

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
	let currentMonth = $state(new Date());
	let _init = $state(false);

	$effect(() => {
		if (_init) return;
		viewSlot = data.selectedSlot;
		viewDate = data.selectedSlot?.slice(0, 10) ?? firstDate;
		if (viewDate) {
			currentMonth = new Date(Number(viewDate.slice(0, 4)), Number(viewDate.slice(5, 7)) - 1, 1);
		}
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

	// ---- calendar grid ----
	let grid = $derived.by(() => {
		const y = currentMonth.getFullYear();
		const m = currentMonth.getMonth();
		const firstDay = new Date(y, m, 1);
		const lastDay = new Date(y, m + 1, 0);
		const startDow = firstDay.getDay();
		const daysInMonth = lastDay.getDate();

		const rows: ({ day: number; key: string } | null)[][] = [];
		let week: ({ day: number; key: string } | null)[] = [];

		const pad = (n: number) => String(n).padStart(2, '0');

		for (let i = 0; i < startDow; i++) week.push(null);

		for (let d = 1; d <= daysInMonth; d++) {
			week.push({ day: d, key: `${y}-${pad(m + 1)}-${pad(d)}` });
			if (week.length === 7) {
				rows.push(week);
				week = [];
			}
		}

		if (week.length > 0) {
			while (week.length < 7) week.push(null);
			rows.push(week);
		}

		return rows;
	});

	let monthLabel = $derived(
		currentMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
	);

	const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	// ---- actions ----
	function prevMonth() {
		currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
	}

	function nextMonth() {
		currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
	}

	const MOBILE_MQ = '(max-width: 768px)';

	let timelineEl = $state<HTMLElement | null>(null);
	let formEl = $state<HTMLElement | null>(null);

	function scrollTo(el: HTMLElement | null) {
		if (!el || !window.matchMedia(MOBILE_MQ).matches) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	function selectDate(key: string) {
		if (!availableDates.has(key)) return;
		viewDate = key;
		if (viewSlot && !viewSlot.startsWith(key)) {
			viewSlot = null;
			history.replaceState({}, '', '?');
		}
		const [y, m] = key.split('-').map(Number);
		currentMonth = new Date(y, m - 1, 1);
		scrollTo(timelineEl);
	}

	function selectSlot(iso: string) {
		viewSlot = iso;
		viewDate = iso.slice(0, 10);
		currentMonth = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 1);
		history.replaceState({}, '', `?slot=${encodeURIComponent(iso)}`);
		scrollTo(formEl);
	}

	function clearSlot() {
		viewSlot = null;
		history.replaceState({}, '', '?');
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

	function fmtDateShort(key: string): string {
		try {
			return Temporal.PlainDate.from(key).toLocaleString(undefined, {
				month: 'long',
				day: 'numeric'
			});
		} catch {
			return key;
		}
	}

	function isToday(key: string) {
		return key === todayKey;
	}

	function isPast(key: string) {
		return key < todayKey;
	}
</script>

<svelte:head>
	<title>{data.eventType.name} — {data.user.name}</title>
</svelte:head>

<div class="booking">
	<header class="booking-header">
		{#if data.reschedule}
			<p class="reschedule-badge">Reschedule</p>
		{/if}
		<a href="/" class="host-info" aria-label="Back to all event types">
			<span class="back-arrow" aria-hidden="true">&larr;</span>
			{#if data.user.branding?.logo_url}
				<img src={data.user.branding.logo_url} alt="" class="host-avatar" />
			{/if}
			<span class="host-name">{data.user.name}</span>
		</a>
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
					<div class="calendar-nav">
						<button class="nav-btn" onclick={prevMonth} aria-label="Previous month">&lsaquo;</button
						>
						<span class="month-label">{monthLabel}</span>
						<button class="nav-btn" onclick={nextMonth} aria-label="Next month">&rsaquo;</button>
					</div>

					<div class="calendar-grid">
						<div class="day-headers">
							{#each dayHeaders as h (h)}
								<span class="day-header">{h}</span>
							{/each}
						</div>
						{#each grid as week, wi (wi)}
							<div class="week-row">
								{#each week as cell, ci (cell?.key ?? `c${ci}`)}
									{#if cell}
										{@const key = cell.key}
										{@const hasSlots = availableDates.has(key)}
										<button
											class="day-cell"
											class:available={hasSlots}
											class:selected={key === viewDate}
											class:today={isToday(key)}
											class:past={isPast(key)}
											disabled={!hasSlots || isPast(key)}
											onclick={() => selectDate(key)}
											aria-label={fmtDate(key)}
										>
											{cell.day}
										</button>
									{:else}
										<span class="day-cell empty"></span>
									{/if}
								{/each}
							</div>
						{/each}
					</div>

					<p class="tz-note">Times shown in {localTz.replace(/_/g, ' ')}</p>
				</div>

			{#if viewDate && timeline}
				<div class="timeline-container" bind:this={timelineEl}>
						<h2 class="slots-date">{fmtDate(viewDate)}</h2>
						<div class="timeline-scroll">
							<div
								class="timeline"
								style:height="{Math.max(600, (timeline.totalMs / 3600000) * 80)}px"
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
					<p>Select a highlighted date to see available times.</p>
				</div>
			{/if}

			<div class="booking-form" bind:this={formEl}>
				{#if viewSlot}
						<div class="confirmed-slot">
							<span class="slot-time">{fmtTime(viewSlot)}</span>
							<span class="slot-date">&mdash; {fmtDateShort(viewSlot.slice(0, 10))}</span>
						</div>
						<button class="change-link" onclick={clearSlot}>Change</button>

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
								<label for="name">Name</label>
								<input
									id="name"
									name="name"
									required
									autocomplete="name"
									value={data.reschedule?.name ?? ''}
								/>
							</div>

							<div class="field">
								<label for="email">Email</label>
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
									<span class="field-label">Location</span>
									<p class="location-display">{data.eventType.location.fixed}</p>
								</div>
							{:else if data.eventType.location?.mode === 'guest_proposes'}
								<div class="field">
									<label for="location">Meeting location</label>
									<input id="location" name="location" required />
								</div>
							{:else if data.eventType.location?.mode === 'choice'}
								<div class="field">
									<label for="location">Meeting location</label>
									<select id="location" name="location" required>
										{#each data.eventType.location.choices as choice (choice)}
											<option value={choice}>{choice}</option>
										{/each}
									</select>
								</div>
							{/if}

							<div class="field">
								<label for="notes">Notes <span class="optional">(optional)</span></label>
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

	.host-info {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
		text-decoration: none;
		color: inherit;
		transition: opacity var(--transition);
	}

	.host-info:hover {
		opacity: 0.8;
	}

	.back-arrow {
		color: var(--text-disabled);
		font-size: var(--font-size-lg);
		line-height: 1;
	}

	.host-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		object-fit: cover;
	}

	.host-name {
		color: var(--text-muted);
		font-size: var(--font-size-base);
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

	/* ---- calendar nav ---- */
	.calendar-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-5);
	}

	.nav-btn {
		background: none;
		border: none;
		font-size: var(--font-size-2xl);
		color: var(--text-muted);
		cursor: pointer;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
		line-height: 1;
	}

	.nav-btn:hover {
		background: var(--surface-muted);
		color: var(--text);
	}

	.month-label {
		font-weight: 600;
		font-size: var(--font-size-md);
	}

	/* ---- calendar grid ---- */
	.calendar-grid {
		user-select: none;
	}

	.day-headers {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		margin-bottom: var(--space-1);
	}

	.day-header {
		text-align: center;
		font-size: var(--font-size-xs);
		color: var(--text-disabled);
		font-weight: 600;
		text-transform: uppercase;
		padding: var(--space-2) 0;
		letter-spacing: 0.025em;
	}

	.week-row {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
	}

	.day-cell {
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--font-size-sm);
		border: none;
		background: none;
		cursor: pointer;
		border-radius: var(--radius);
		color: var(--text);
		transition: background var(--transition);
		position: relative;
	}

	.day-cell.empty {
		cursor: default;
	}

	.day-cell.past {
		color: var(--border-strong);
		cursor: default;
	}

	.day-cell:not(.past):not(.empty):not(:disabled):hover {
		background: var(--surface-muted);
	}

	.day-cell.available {
		font-weight: 600;
		color: var(--accent);
	}

	.day-cell.available:not(.selected):hover {
		background: var(--surface-accent);
	}

	.day-cell.today:not(.selected)::after {
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

	.day-cell.selected {
		background: var(--accent);
		color: var(--text-on-accent);
	}

	.day-cell.selected.today::after {
		background: var(--text-on-accent);
	}

	.day-cell:disabled {
		cursor: default;
		color: var(--border-strong);
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
		overflow-y: auto;
		overflow-x: hidden;
		padding-right: var(--space-2);
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
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin-bottom: var(--space-1);
		flex-wrap: wrap;
	}

	.slot-time {
		font-size: var(--font-size-xl);
		font-weight: 600;
	}

	.slot-date {
		color: var(--text-muted);
		font-size: var(--font-size-md);
	}

	.change-link {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: var(--font-size-sm);
		padding: 0;
		margin-bottom: var(--space-6);
		text-decoration: underline;
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

	.optional {
		color: var(--text-disabled);
		font-weight: 400;
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
</style>
