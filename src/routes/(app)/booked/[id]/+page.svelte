<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconCalendarPlus from 'virtual:icons/ph/calendar-plus';
	import IconClock from 'virtual:icons/ph/clock';
	import IconMapPin from 'virtual:icons/ph/map-pin';
	import IconPencilSimple from 'virtual:icons/ph/pencil-simple';
	import IconUser from 'virtual:icons/ph/user';

	let { data } = $props();

	let userTz = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

	function fmtDateShort(iso: string): string {
		try {
			return Temporal.Instant.from(iso).toZonedDateTimeISO(userTz).toLocaleString(undefined, {
				year: 'numeric',
				month: 'numeric',
				day: 'numeric'
			});
		} catch {
			return iso;
		}
	}

	function fmtWeekday(iso: string): string {
		try {
			return Temporal.Instant.from(iso)
				.toZonedDateTimeISO(userTz)
				.toLocaleString(undefined, { weekday: 'long' });
		} catch {
			return '';
		}
	}

	function fmtTimeRange(start: string, end: string): string {
		try {
			const s = Temporal.Instant.from(start).toZonedDateTimeISO(userTz);
			const e = Temporal.Instant.from(end).toZonedDateTimeISO(userTz);
			const time = (z: Temporal.ZonedDateTime) =>
				z.toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' });
			return `${time(s)} – ${time(e)}`;
		} catch {
			return `${start} – ${end}`;
		}
	}

	function fmtTzShort(tz: string): string {
		try {
			const fmt = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' });
			const parts = fmt.formatToParts(new Date());
			const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
			const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
			return offset ? `${city} · ${offset}` : city;
		} catch {
			return tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
		}
	}

	let status = $derived(data.appointment.status);
	let isPendingPastStart = $derived(status === 'pending' && data.clockStatus !== 'upcoming');
	let canRebook = $derived(status === 'declined' || status === 'cancelled');
</script>

<svelte:head>
	{#if status === 'cancelled'}
		<title>Booking cancelled — When</title>
	{:else if status === 'declined'}
		<title>Booking declined — When</title>
	{:else if status === 'pending'}
		<title>Booking requested — When</title>
	{:else}
		<title>Booking confirmed — When</title>
	{/if}
</svelte:head>

<div class="page">
	<header class="status-banner">
		<p
			class="status-label"
			class:status-confirmed={status === 'confirmed'}
			class:status-pending={status === 'pending'}
			class:status-declined={status === 'declined'}
			class:status-cancelled={status === 'cancelled'}
		>
			{#if status === 'confirmed'}Confirmed
			{:else if status === 'pending'}Pending
			{:else if status === 'declined'}Declined
			{:else}Cancelled{/if}
		</p>
		{#if data.clockStatus}
			<p class="clock-label">
				{#if data.clockStatus === 'upcoming'}Upcoming
				{:else if data.clockStatus === 'in_progress'}In progress
				{:else}Concluded
				{/if}
			</p>
		{/if}
	</header>

	{#if status === 'pending'}
		<p class="status-sub">
			{#if isPendingPastStart}
				This time has passed — still awaiting confirmation.
			{:else}
				Waiting for {data.user.name} to confirm.
			{/if}
		</p>
	{:else if status === 'declined'}
		<p class="status-sub">{data.user.name} declined this request.</p>
	{:else if status === 'cancelled'}
		<p class="status-sub">This booking was cancelled.</p>
	{/if}

	<article class="card">
		<section class="card-section card-section-header">
			<h1 class="event-name">{data.eventType.name}</h1>
			<p class="event-meta">
				{data.eventType.duration} min{#if data.eventType.description}
					&middot; {data.eventType.description}{/if}
			</p>
		</section>

		<section class="card-section detail-list">
			<div class="detail-row">
				<IconCalendarBlank class="detail-icon" aria-hidden="true" />
				<div class="detail-text">
					<div class="detail-primary">{fmtDateShort(data.appointment.start_time)}</div>
					<div class="detail-secondary">{fmtWeekday(data.appointment.start_time)}</div>
				</div>
			</div>
			<div class="detail-row">
				<IconClock class="detail-icon" aria-hidden="true" />
				<div class="detail-text">
					<div class="detail-primary">
						{fmtTimeRange(data.appointment.start_time, data.appointment.end_time)}
					</div>
					<div class="detail-secondary">{fmtTzShort(userTz)}</div>
				</div>
			</div>
			{#if data.appointment.location}
				<div class="detail-row">
					<IconMapPin class="detail-icon" aria-hidden="true" />
					<div class="detail-text">
						<div class="detail-primary">{data.appointment.location}</div>
					</div>
				</div>
			{/if}
			<div class="detail-row">
				<IconUser class="detail-icon" aria-hidden="true" />
				<div class="detail-text">
					<div class="detail-primary">{data.appointment.attendee_name}</div>
					<div class="detail-secondary">Attendee (you)</div>
				</div>
			</div>
			<div class="detail-row">
				<IconUser class="detail-icon" aria-hidden="true" />
				<div class="detail-text">
					<div class="detail-primary">{data.user.name}</div>
					<div class="detail-secondary">Attendee</div>
				</div>
			</div>
		</section>
	</article>

	{#if data.calendarLinks}
		<section class="add-to-calendar">
			<header class="atc-header">
				<IconCalendarPlus class="atc-header-icon" aria-hidden="true" />
				<h2 class="atc-title">Add to your calendar</h2>
			</header>
			<div class="atc-links">
				<a
					class="atc-link"
					href={data.calendarLinks.google}
					target="_blank"
					rel="noopener noreferrer">Google</a
				>
				<a
					class="atc-link"
					href={data.calendarLinks.outlook}
					target="_blank"
					rel="noopener noreferrer">Outlook</a
				>
				<a class="atc-link" href={data.calendarLinks.ics}>Apple</a>
				<a class="atc-link" href={data.calendarLinks.ics} download="when-{data.appointment.id}.ics"
					>ICS</a
				>
			</div>
		</section>
	{/if}

	{#if data.actions.reschedule.allowed || data.actions.cancel.allowed}
		<section class="changes">
			<header class="changes-header">
				<IconPencilSimple class="changes-header-icon" aria-hidden="true" />
				<h2 class="changes-title">Change of plans?</h2>
			</header>
			<div class="changes-links">
				{#if data.actions.reschedule.allowed}
					<a
						class="changes-link changes-link-reschedule"
						href="/booked/{data.appointment.id}/reschedule?token={encodeURIComponent(data.token)}"
					>
						Reschedule
						<IconArrowRight class="action-arrow" aria-hidden="true" />
					</a>
				{/if}
				{#if data.actions.cancel.allowed}
					<a
						class="changes-link changes-link-cancel"
						href="/booked/{data.appointment.id}/cancel?token={encodeURIComponent(data.token)}"
					>
						Cancel booking
					</a>
				{/if}
			</div>
		</section>
	{/if}

	{#if canRebook}
		<section class="rebook">
			<a class="rebook-btn" href="/schedule/{data.eventType.slug}">
				Pick another time
				<IconArrowRight class="action-arrow" aria-hidden="true" />
			</a>
		</section>
	{/if}
</div>

<style>
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-8) var(--space-6) var(--space-10);
		color: var(--text);
	}

	/* ---- status banner ---- */
	.status-banner {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin: 0 0 var(--space-3);
	}

	.status-label {
		font-size: var(--font-size-2xl);
		font-weight: 700;
		margin: 0;
	}

	.status-confirmed {
		color: var(--primary);
	}

	.status-pending {
		color: var(--text-secondary);
	}

	.status-declined {
		color: var(--danger);
	}

	.status-cancelled {
		color: var(--text-muted);
	}

	.clock-label {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		margin: 0;
		padding: 2px var(--space-3);
		background: var(--surface-muted);
		border-radius: var(--radius-pill);
	}

	.status-sub {
		color: var(--text-muted);
		font-size: var(--font-size-md);
		margin: 0 0 var(--space-6);
	}

	.status-banner + .card,
	.status-banner + .status-sub + .card {
		margin-top: 0;
	}

	.card {
		margin-top: var(--space-3);
	}

	/* ---- card ---- */
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.card-section {
		padding: var(--space-6) var(--space-7);
	}

	.card-section + .card-section {
		border-top: 1px solid var(--border);
	}

	.card-section-header {
		background: var(--surface-muted);
	}

	.event-name {
		font-size: var(--font-size-xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
	}

	.event-meta {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin: 0;
	}

	/* ---- detail rows ---- */
	.detail-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.detail-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
	}

	:global(.detail-icon) {
		font-size: var(--font-size-lg);
		color: var(--text-muted);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.detail-text {
		min-width: 0;
	}

	.detail-primary {
		color: var(--text);
		font-weight: 500;
		font-size: var(--font-size-md);
		line-height: 1.4;
	}

	.detail-secondary {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin-top: 2px;
	}

	/* ---- add to calendar ---- */
	.add-to-calendar {
		margin-top: var(--space-7);
	}

	.atc-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
	}

	:global(.atc-header-icon) {
		font-size: var(--font-size-lg);
		color: var(--text-muted);
	}

	.atc-title {
		font-size: var(--font-size-md);
		font-weight: 600;
		margin: 0;
	}

	.atc-links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.atc-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3) var(--space-5);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
		font-size: var(--font-size-sm);
		font-weight: 600;
		transition:
			background var(--transition),
			border-color var(--transition);
	}

	.atc-link:hover {
		background: var(--surface-muted);
		border-color: var(--primary);
	}

	/* ---- changes section ---- */
	.changes {
		margin-top: var(--space-7);
	}

	.changes-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
	}

	:global(.changes-header-icon) {
		font-size: var(--font-size-lg);
		color: var(--text-muted);
	}

	.changes-title {
		font-size: var(--font-size-md);
		font-weight: 600;
		margin: 0;
	}

	.changes-links {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.changes-link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		text-decoration: none;
		font-size: var(--font-size-sm);
		font-weight: 600;
		transition:
			background var(--transition),
			border-color var(--transition),
			color var(--transition);
	}

	.changes-link-reschedule {
		color: var(--text);
		background: transparent;
	}

	.changes-link-reschedule:hover {
		background: var(--surface-muted);
		border-color: var(--primary);
	}

	.changes-link-cancel {
		color: var(--danger);
		background: transparent;
	}

	.changes-link-cancel:hover {
		color: var(--danger-strong);
		background: var(--danger-bg);
		border-color: var(--danger);
	}

	:global(.action-arrow) {
		display: inline-block;
		transition: transform var(--transition);
	}

	.changes-link:hover :global(.action-arrow) {
		transform: translateX(2px);
	}

	/* ---- rebook CTA (declined / cancelled) ---- */
	.rebook {
		margin-top: var(--space-8);
		display: flex;
		justify-content: center;
	}

	.rebook-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-7);
		background: var(--primary);
		color: var(--text-on-primary);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		text-decoration: none;
		transition: opacity var(--transition);
	}

	.rebook-btn:hover {
		opacity: 0.9;
	}

	.rebook-btn:hover :global(.action-arrow) {
		transform: translateX(2px);
	}

	@media (max-width: 768px) {
		.page {
			padding: var(--space-5) var(--space-5) var(--space-9);
		}

		.card-section {
			padding: var(--space-5) var(--space-5);
		}

		.changes-links {
			flex-direction: column;
			align-items: stretch;
		}

		.changes-link {
			justify-content: center;
			min-height: 48px;
		}

		.rebook-btn {
			width: 100%;
			justify-content: center;
			min-height: 56px;
		}
	}
</style>
