<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';

	let { data, form } = $props();

	let slotsByDate = $derived(data.slotsByDate as Record<string, string[]>);
	let availableDates = $derived(new Set(Object.keys(slotsByDate)));
	let firstDate = $derived(Object.keys(slotsByDate)[0] ?? null);
	let localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
	let daySlots = $derived(viewDate ? (slotsByDate[viewDate] ?? []) : []);

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

	function selectDate(key: string) {
		if (!availableDates.has(key)) return;
		viewDate = key;
		if (viewSlot && !viewSlot.startsWith(key)) {
			viewSlot = null;
			history.replaceState({}, '', '?');
		}
		const [y, m] = key.split('-').map(Number);
		currentMonth = new Date(y, m - 1, 1);
	}

	function selectSlot(iso: string) {
		viewSlot = iso;
		viewDate = iso.slice(0, 10);
		currentMonth = new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 1);
		history.replaceState({}, '', `?slot=${encodeURIComponent(iso)}`);
	}

	function clearSlot() {
		viewSlot = null;
		history.replaceState({}, '', '?');
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
		<div class="host-info">
			{#if data.user.branding?.logo_url}
				<img src={data.user.branding.logo_url} alt="" class="host-avatar" />
			{/if}
			<span class="host-name">{data.user.name}</span>
		</div>
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
					<button class="nav-btn" onclick={prevMonth} aria-label="Previous month">&lsaquo;</button>
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

			<div class="selection-panel">
				{#if viewSlot}
					<div class="booking-form">
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
					</div>
				{:else if viewDate && daySlots.length > 0}
					<div class="time-slots">
						<h2 class="slots-date">{fmtDate(viewDate)}</h2>
						<div class="slots-list">
							{#each daySlots as iso (iso)}
								<button class="slot-btn" onclick={() => selectSlot(iso)}>
									{fmtTime(iso)}
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<div class="time-slots empty-state">
						<p>Select a highlighted date to see available times.</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.booking {
		max-width: 880px;
		margin: 0 auto;
		padding: 32px 20px 64px;
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
		color: #111827;
	}

	.booking-header {
		margin-bottom: 28px;
	}

	.reschedule-badge {
		display: inline-block;
		background: var(--accent);
		color: #fff;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 2px 10px;
		border-radius: 999px;
		margin-bottom: 8px;
	}

	.host-info {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	.host-avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		object-fit: cover;
	}

	.host-name {
		color: #6b7280;
		font-size: 0.875rem;
	}

	.event-name {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0 0 4px;
	}

	.event-meta {
		color: #6b7280;
		margin: 0;
	}

	.empty {
		text-align: center;
		color: #6b7280;
		padding: 48px 0;
	}

	/* ---- two-column layout ---- */
	.booking-body {
		display: flex;
		gap: 24px;
		align-items: flex-start;
	}

	.calendar-panel {
		flex-shrink: 0;
		width: 308px;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 20px;
	}

	.selection-panel {
		flex: 1;
		min-width: 0;
	}

	/* ---- calendar nav ---- */
	.calendar-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 14px;
	}

	.nav-btn {
		background: none;
		border: none;
		font-size: 1.4rem;
		color: #6b7280;
		cursor: pointer;
		padding: 2px 8px;
		border-radius: 6px;
		line-height: 1;
	}

	.nav-btn:hover {
		background: #f3f4f6;
		color: #111827;
	}

	.month-label {
		font-weight: 600;
		font-size: 0.9375rem;
	}

	/* ---- calendar grid ---- */
	.calendar-grid {
		user-select: none;
	}

	.day-headers {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		margin-bottom: 2px;
	}

	.day-header {
		text-align: center;
		font-size: 0.6875rem;
		color: #9ca3af;
		font-weight: 600;
		text-transform: uppercase;
		padding: 4px 0;
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
		font-size: 0.8125rem;
		border: none;
		background: none;
		cursor: pointer;
		border-radius: 8px;
		color: #111827;
		transition: background 0.12s;
		position: relative;
		font-family: inherit;
	}

	.day-cell.empty {
		cursor: default;
	}

	.day-cell.past {
		color: #d1d5db;
		cursor: default;
	}

	.day-cell:not(.past):not(.empty):not(:disabled):hover {
		background: #f3f4f6;
	}

	.day-cell.available {
		font-weight: 600;
		color: var(--accent);
	}

	.day-cell.available:not(.selected):hover {
		background: #eef2ff;
	}

	.day-cell.today:not(.selected)::after {
		content: '';
		position: absolute;
		bottom: 2px;
		left: 50%;
		transform: translateX(-50%);
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--accent);
	}

	.day-cell.selected {
		background: var(--accent);
		color: #fff;
	}

	.day-cell.selected.today::after {
		background: #fff;
	}

	.day-cell:disabled {
		cursor: default;
		color: #d1d5db;
	}

	.tz-note {
		margin: 14px 0 0;
		font-size: 0.7rem;
		color: #9ca3af;
		text-align: center;
	}

	/* ---- time slots ---- */
	.time-slots {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 24px;
	}

	.slots-date {
		font-size: 1rem;
		font-weight: 600;
		margin: 0 0 16px;
	}

	.slots-list {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 8px;
	}

	.slot-btn {
		padding: 10px 14px;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		background: #fff;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		color: var(--accent);
		transition:
			border-color 0.12s,
			background 0.12s;
		font-family: inherit;
	}

	.slot-btn:hover {
		border-color: var(--accent);
		background: #eef2ff;
	}

	.empty-state {
		text-align: center;
		color: #6b7280;
		padding: 48px 24px;
	}

	/* ---- booking form ---- */
	.booking-form {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 24px;
	}

	.confirmed-slot {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 2px;
		flex-wrap: wrap;
	}

	.slot-time {
		font-size: 1.25rem;
		font-weight: 600;
	}

	.slot-date {
		color: #6b7280;
		font-size: 0.9375rem;
	}

	.change-link {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-size: 0.8125rem;
		padding: 0;
		margin-bottom: 18px;
		text-decoration: underline;
	}

	.form-error {
		background: #fef2f2;
		color: #dc2626;
		padding: 10px 14px;
		border-radius: 8px;
		font-size: 0.875rem;
		margin-bottom: 18px;
	}

	.field {
		margin-bottom: 14px;
	}

	.field label,
	.field-label {
		display: block;
		font-size: 0.8125rem;
		font-weight: 600;
		margin-bottom: 4px;
		color: #374151;
	}

	.optional {
		color: #9ca3af;
		font-weight: 400;
	}

	.field input,
	.field select,
	.field textarea {
		width: 100%;
		padding: 9px 12px;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.9375rem;
		font-family: inherit;
		box-sizing: border-box;
		transition: border-color 0.12s;
		background: #fff;
		color: #111827;
	}

	.field input:focus,
	.field select:focus,
	.field textarea:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
	}

	.location-display {
		color: #6b7280;
		font-size: 0.9375rem;
		margin: 0;
	}

	.submit-btn {
		width: 100%;
		padding: 11px 20px;
		background: var(--accent);
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.12s;
		margin-top: 4px;
	}

	.submit-btn:hover {
		opacity: 0.9;
	}

	/* ---- responsive ---- */
	@media (max-width: 640px) {
		.booking-body {
			flex-direction: column;
		}

		.calendar-panel {
			width: 100%;
		}

		.slots-list {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		}
	}
</style>
