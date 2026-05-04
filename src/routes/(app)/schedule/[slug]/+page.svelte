<script lang="ts">
	import { tick } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { Temporal } from '@js-temporal/polyfill';
	import { Calendar, Dialog } from 'bits-ui';
	import { CalendarDate, type DateValue } from '@internationalized/date';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconCaretRight from 'virtual:icons/ph/caret-right';
	import IconClock from 'virtual:icons/ph/clock';
	import IconGlobe from 'virtual:icons/ph/globe';

	let { data, form } = $props();

	let userTz = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

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

	let allSlots = $derived(Object.values(data.slotsByDate as Record<string, string[]>).flat());
	let availableDates = $derived.by(() => {
		const set = new SvelteSet<string>();
		for (const iso of allSlots) {
			set.add(Temporal.Instant.from(iso).toZonedDateTimeISO(userTz).toPlainDate().toString());
		}
		return set;
	});
	let firstDate = $derived([...availableDates].sort()[0] ?? null);

	// User-controlled state — initialized in $effect below
	let viewSlot = $state<string | null>(null);
	let viewDate = $state<string | null>(null);
	let step = $state<1 | 2 | 3>(1);
	let _init = $state(false);

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

	$effect(() => {
		if (_init) return;
		viewSlot = data.selectedSlot;
		viewDate = data.selectedSlot?.slice(0, 10) ?? firstDate;
		if (viewSlot) step = 3;
		_init = true;
	});

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

	// ---- calendar helpers ----
	function isDateUnavailable(date: DateValue): boolean {
		return !availableDates.has(dateToStr(date));
	}

	function isDateDisabled(date: DateValue): boolean {
		return dateToStr(date) < todayKey;
	}

	// ---- actions ----
	function onDateChange(date: DateValue | undefined) {
		if (!date) {
			viewDate = null;
			if (viewSlot) {
				viewSlot = null;
				replaceState('?', {});
			}
			return;
		}
		const key = dateToStr(date);
		if (!availableDates.has(key)) return;
		viewDate = key;
		if (viewSlot && !viewSlot.startsWith(key)) {
			viewSlot = null;
			replaceState('?', {});
		}
	}

	function selectSlot(iso: string) {
		viewSlot = iso;
		viewDate = iso.slice(0, 10);
		replaceState(`?slot=${encodeURIComponent(iso)}`, {});
	}

	function clearSlot() {
		viewSlot = null;
		replaceState('?', {});
	}

	// ---- wizard ----
	let nameInput = $state<HTMLInputElement | null>(null);
	let stepTitle = $derived(step === 1 ? 'Pick a day' : step === 2 ? 'Pick a time' : 'Your details');
	let canAdvance = $derived(step === 1 ? !!viewDate : step === 2 ? !!viewSlot : true);

	$effect(() => {
		if (step === 3 && viewSlot) {
			nameInput?.focus();
		}
	});

	function advance() {
		if (!canAdvance || step === 3) return;
		step = (step + 1) as 1 | 2 | 3;
		window.scrollTo({ top: 0 });
	}

	function goBack() {
		if (step === 1) return;
		step = (step - 1) as 1 | 2 | 3;
		window.scrollTo({ top: 0 });
	}

	// ---- timeline day view ----
	let timeline = $derived.by(() => {
		if (!viewDate) return null;

		const dateObj = Temporal.PlainDate.from(viewDate);
		const startOfDay = dateObj.toZonedDateTime(userTz).toInstant();
		const endOfDay = dateObj.add({ days: 1 }).toZonedDateTime(userTz).toInstant();

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

	// ---- timeline interaction (tap to place, tap-on-box to clear, drag to move) ----
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
		const current = timeline?.slots.find((s) => s.iso === viewSlot);
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
					if (best && best.iso !== viewSlot) selectSlot(best.iso);
				}
			} else {
				clearSlot();
			}
		} else {
			if (!isDragging) {
				const percent = pointToPercent(e.clientY);
				if (!isUnavailable(percent)) {
					const best = nearestSlotAt(percent);
					if (best && best.iso !== viewSlot) selectSlot(best.iso);
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

	// ---- formatting ----
	function fmtSlot(iso: string): string {
		try {
			const instant = Temporal.Instant.from(iso);
			return instant.toZonedDateTimeISO(userTz).toLocaleString(undefined, {
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
				.toZonedDateTimeISO(userTz)
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
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="banner-desc">{@html data.user.branding.descriptionHtml}</div>
			{/if}
		</div>
	</a>
	<div class="banner-event">
		{#if data.reschedule}
			<p class="reschedule-badge">Reschedule</p>
		{/if}
		<h1 class="banner-event-name">{data.eventType.name}</h1>
		<p class="banner-event-meta">
			{data.eventType.duration} min{#if data.eventType.description}
				&middot; {data.eventType.description}{/if}
		</p>
	</div>
</header>

<div class="booking" data-step={step}>
	{#if availableDates.size === 0}
		<p class="empty">No availability in the near future.</p>
	{:else}
		<div class="card">
			<aside class="card-context">
				<section class="context-section">
					<a href="/" class="context-provider">
						{#if data.user.branding?.avatar_url || data.user.branding?.logo_url}
							<img
								src={data.user.branding?.avatar_url || data.user.branding?.logo_url}
								alt={data.user.name}
								class="context-provider-avatar"
							/>
						{/if}
						<div class="context-provider-text">
							<span class="context-provider-name"
								>{data.user.branding?.page_title || data.user.name}</span
							>
							{#if data.user.branding?.descriptionHtml}
								<!-- eslint-disable svelte/no-at-html-tags -->
								<div class="context-provider-desc">
									{@html data.user.branding.descriptionHtml}
								</div>
								<!-- eslint-enable svelte/no-at-html-tags -->
							{/if}
						</div>
					</a>
				</section>

				<section class="context-section context-section-about">
					{#if data.reschedule}
						<p class="reschedule-badge">Reschedule</p>
					{/if}
					<h2 class="context-event-name">{data.eventType.name}</h2>
					<p class="context-event-meta">{data.eventType.duration} min</p>
					{#if data.eventType.description}
						<p class="context-event-description">{data.eventType.description}</p>
					{/if}
				</section>

				{#if (step >= 2 && viewDate) || (step >= 3 && viewSlot)}
					<section class="context-section">
						<div class="context-summary">
							{#if step >= 2 && viewDate}
								<button
									type="button"
									class="context-summary-row"
									onclick={() => (step = 1)}
									aria-label="Change date"
								>
									<IconCalendarBlank class="context-summary-icon" aria-hidden="true" />
									<div class="context-summary-value">
										<span class="context-summary-text">{fmtDate(viewDate)}</span>
									</div>
								</button>
							{/if}
							{#if step >= 3 && viewSlot}
								<button
									type="button"
									class="context-summary-row"
									onclick={() => (step = 2)}
									aria-label="Change time"
								>
									<IconClock class="context-summary-icon" aria-hidden="true" />
									<div class="context-summary-value">
										<span class="context-summary-text">{fmtTime(viewSlot)}</span>
										<span class="context-summary-tz">{fmtTzShort(userTz)}</span>
									</div>
								</button>
							{/if}
						</div>
					</section>
				{/if}
			</aside>

			<div class="card-stage">
				<div class="wizard-bar">
					<button
						type="button"
						class="back-btn"
						onclick={goBack}
						disabled={step === 1}
						aria-label="Go back"
					>
						&lsaquo;
					</button>
					<h1 class="wizard-title">
						<span class="wizard-step">Step {step} of 3:</span>
						{stepTitle}
					</h1>
				</div>

				<div class="booking-body">
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

										{#each timeline.buffers as b, bi (bi)}
											<div
												class="buffer-block"
												style:top="{b.top}%"
												style:height="{b.height}%"
											></div>
										{/each}

										{#each timeline.busy as b, bi (bi)}
											<div class="busy-block" style:top="{b.top}%" style:height="{b.height}%">
												<span class="busy-text">Busy</span>
											</div>
										{/each}

										{#if viewSlot}
											{@const s = timeline.slots.find((s) => s.iso === viewSlot)}
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
									</div>
								</div>
							</div>
						</div>
					{:else}
						<div class="timeline-container empty-state">
							<p>Select a highlighted date to see available times.</p>
						</div>
					{/if}

					<div class="booking-form">
						{#if viewSlot}
							<p class="confirmed-slot">{fmtSlot(viewSlot)}</p>

							{#if form?.error}
								<p class="form-error" role="alert">{form.error}</p>
							{/if}

							<form
								id="booking-form"
								method="POST"
								action={data.reschedule ? '?/reschedule' : '?/book'}
							>
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
										bind:this={nameInput}
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

				<div class="wizard-cta">
					<p class="cta-title">
						<span class="wizard-step">Step {step} of 3:</span>
						{stepTitle}
					</p>
					{#if step === 1 && viewDate}
						<p class="cta-summary">You selected {fmtDate(viewDate)}</p>
					{:else if step === 2 && viewSlot}
						<p class="cta-summary">You selected {fmtTime(viewSlot)}</p>
					{/if}

					{#if step === 1}
						<button type="button" class="cta-btn" onclick={advance} disabled={!canAdvance}>
							Continue <IconArrowRight aria-hidden="true" class="cta-arrow" />
						</button>
					{:else if step === 2}
						<button type="button" class="cta-btn" onclick={advance} disabled={!canAdvance}>
							Confirm <IconArrowRight aria-hidden="true" class="cta-arrow" />
						</button>
					{:else}
						<button type="submit" form="booking-form" class="cta-btn" disabled={!viewSlot}>
							{data.reschedule ? 'Reschedule' : 'Book'}
						</button>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

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
	.booking {
		max-width: 960px;
		margin: 0 auto;
		padding: var(--space-8) var(--space-6) var(--space-10);
		color: var(--text);
	}

	.reschedule-badge {
		display: inline-block;
		background: var(--primary);
		color: var(--text-on-primary);
		font-size: var(--font-size-xs);
		font-weight: 600;
		padding: var(--space-1) var(--space-4);
		border-radius: var(--radius-pill);
		margin: 0 0 var(--space-3);
	}

	.empty {
		text-align: center;
		color: var(--text-muted);
		padding: var(--space-9) 0;
	}

	/* ---- card layout ---- */
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		display: flex;
		overflow: hidden;
		min-height: 520px;
	}

	.card-context {
		flex: 0 0 30%;
		padding: var(--space-7);
		border-right: 1px solid var(--border);
		background: var(--surface-muted);
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}

	.context-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.context-section-about {
		padding: var(--space-6) 0;
		border-top: 1px solid var(--border-strong);
		border-bottom: 1px solid var(--border-strong);
	}

	.context-provider {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		text-decoration: none;
		color: inherit;
		min-width: 0;
	}

	.context-provider:hover .context-provider-name {
		opacity: 0.8;
	}

	.context-provider-avatar {
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
	}

	.context-provider-text {
		min-width: 0;
	}

	.context-provider-name {
		font-size: var(--font-size-md);
		font-weight: 700;
		transition: opacity var(--transition);
	}

	.context-provider-desc {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin-top: var(--space-1);
	}

	.context-provider-desc :global(p) {
		margin: 0;
	}

	.context-event-name {
		font-size: var(--font-size-xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
		color: var(--text);
	}

	.context-event-meta {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin: 0 0 var(--space-3);
	}

	.context-event-description {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin: 0;
		line-height: 1.5;
	}

	.context-summary {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.context-summary-row {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: var(--space-3);
		text-align: left;
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		font: inherit;
		color: var(--text-muted);
		position: relative;
		z-index: 0;
		transition: color var(--transition);
	}

	.context-summary-row::before {
		content: '';
		position: absolute;
		inset: calc(var(--space-4) * -1);
		background: transparent;
		border-radius: var(--radius-sm);
		transition: background var(--transition);
		z-index: -1;
	}

	.context-summary-row:hover {
		color: var(--text);
	}

	.context-summary-row:hover::before {
		background: var(--surface);
	}

	:global(.context-summary-icon) {
		font-size: var(--font-size-lg);
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.context-summary-row:hover :global(.context-summary-icon) {
		color: var(--text);
	}

	.context-summary-value {
		color: var(--text);
		font-weight: 500;
		font-size: var(--font-size-md);
		line-height: 1.4;
	}

	.context-summary-text {
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 3px;
	}

	.card-stage {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		padding: var(--space-7);
	}

	.booking-body {
		flex: 1;
		min-height: 0;
	}

	/* hide non-active step panels */
	.booking[data-step='1'] .timeline-container,
	.booking[data-step='1'] .booking-form,
	.booking[data-step='2'] .calendar-panel,
	.booking[data-step='2'] .booking-form,
	.booking[data-step='3'] .calendar-panel,
	.booking[data-step='3'] .timeline-container {
		display: none;
	}

	.calendar-panel {
		width: 100%;
		max-width: 360px;
		margin: 0 auto;
	}

	.timeline-container {
		width: 100%;
	}

	.booking-form {
		width: 100%;
		max-width: 480px;
		margin: 0 auto;
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
		bottom: var(--space-1);
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

	.context-summary-tz {
		display: block;
		font-size: var(--font-size-xs);
		font-weight: 500;
		color: var(--text-muted);
		margin-top: var(--space-1);
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

	/* ---- booking form ---- */
	.confirmed-slot {
		font-size: var(--font-size-lg);
		font-weight: 600;
		margin: 0 0 var(--space-6);
		display: none;
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
		border-color: var(--primary);
		box-shadow: var(--shadow-focus);
	}

	.location-display {
		color: var(--text-muted);
		font-size: var(--font-size-md);
		margin: 0;
	}

	.submit-btn {
		display: none;
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

	/* ---- wizard chrome ---- */
	.wizard-bar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0 0 var(--space-6);
		padding-bottom: var(--space-5);
		border-bottom: 1px solid var(--border);
	}

	.back-btn {
		display: none;
		background: none;
		border: none;
		font-size: var(--font-size-2xl);
		color: var(--text);
		cursor: pointer;
		padding: var(--space-1) var(--space-3);
		line-height: 1;
		border-radius: var(--radius-sm);
	}

	.back-btn:disabled {
		color: var(--border-strong);
		cursor: default;
	}

	.wizard-title {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: 600;
		color: var(--text);
	}

	.wizard-step {
		font-weight: 500;
		color: var(--text-muted);
		margin-right: var(--space-2);
	}

	.wizard-cta {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-4);
		margin-top: var(--space-6);
		padding-top: var(--space-5);
		border-top: 1px solid var(--border);
	}

	.cta-summary {
		margin: 0 auto 0 0;
		color: var(--text-secondary);
		font-size: var(--font-size-md);
		font-weight: 500;
		display: flex;
		align-items: center;
	}

	:global(.cta-arrow) {
		display: inline-block;
		margin-left: var(--space-2);
		transition: transform var(--transition);
	}

	.cta-btn:not(:disabled):hover :global(.cta-arrow) {
		transform: translateX(2px);
	}

	.cta-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-3) var(--space-7);
		background: var(--primary);
		color: var(--text-on-primary);
		border: none;
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--transition);
	}

	.cta-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.cta-btn:not(:disabled):hover {
		opacity: 0.9;
	}

	/* ---- page banner (full-width) ---- */
	.page-banner {
		width: 100%;
		border-bottom: 1px solid var(--border);
		padding: var(--space-5) var(--space-7);
		display: flex;
		align-items: center;
		gap: var(--space-5);
	}

	.banner-link {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		text-decoration: none;
		color: inherit;
		flex: 1;
		max-width: 960px;
		min-width: 0;
	}

	.banner-event {
		display: none;
		flex: 1;
		min-width: 0;
	}

	.banner-event-name {
		font-size: var(--font-size-md);
		font-weight: 700;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.banner-event-meta {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin: var(--space-1) 0 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.banner-event .reschedule-badge {
		font-size: var(--font-size-xs);
		font-weight: 600;
		display: inline-block;
		background: var(--primary);
		color: var(--text-on-primary);
		padding: 2px var(--space-3);
		border-radius: var(--radius-pill);
		margin: 0 0 var(--space-1);
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

	/* ---- desktop-only: hide page banner (provider info moved to sidebar) ---- */
	@media (min-width: 769px) {
		.page-banner {
			display: none;
		}

		.cta-title {
			display: none;
		}
	}

	/* ---- responsive ---- */
	@media (max-width: 768px) {
		.page-banner {
			padding: var(--space-4) var(--space-5);
		}

		.banner-link {
			flex: 0 0 auto;
		}

		.banner-text {
			display: none;
		}

		.banner-event {
			display: block;
		}

		.booking {
			padding: var(--space-5) var(--space-5) calc(var(--space-9) + 64px);
		}

		.card {
			background: transparent;
			border: none;
			border-radius: 0;
			min-height: 0;
			display: block;
		}

		.card-context {
			display: none;
		}

		.card-stage {
			padding: 0;
		}

		.confirmed-slot {
			display: block;
		}

		.wizard-bar {
			display: none;
		}

		.timeline-scroll {
			max-height: none;
			overflow: visible;
		}

		.cta-summary {
			display: none;
		}

		.cta-title {
			margin: 0 0 var(--space-2);
			font-size: var(--font-size-md);
			font-weight: 600;
			color: var(--text);
		}

		.cta-btn {
			min-height: 56px;
			width: 100%;
			padding: var(--space-4) var(--space-6);
		}

		.wizard-cta {
			display: block;
			justify-content: initial;
			border-top: none;
			padding-top: 0;
			margin: 0;
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			padding: var(--space-4) var(--space-5) calc(var(--space-4) + env(safe-area-inset-bottom));
			background: var(--bg);
			border-top: 1px solid var(--border);
			z-index: 100;
		}
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
