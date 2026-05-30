<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconClock from 'virtual:icons/ph/clock';
	import IconMapPin from 'virtual:icons/ph/map-pin';
	import IconNote from 'virtual:icons/ph/note';
	import IconUser from 'virtual:icons/ph/user';
	import IconWarning from 'virtual:icons/ph/warning';

	let { data } = $props();

	let browserTz = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);

	function fmtDateShort(iso: string, tz: string): string {
		try {
			return Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toLocaleString(undefined, {
				year: 'numeric',
				month: 'numeric',
				day: 'numeric'
			});
		} catch {
			return iso;
		}
	}

	function fmtWeekday(iso: string, tz: string): string {
		try {
			return Temporal.Instant.from(iso)
				.toZonedDateTimeISO(tz)
				.toLocaleString(undefined, { weekday: 'long' });
		} catch {
			return '';
		}
	}

	function fmtTimeRange(start: string, end: string, tz: string): string {
		try {
			const s = Temporal.Instant.from(start).toZonedDateTimeISO(tz);
			const e = Temporal.Instant.from(end).toZonedDateTimeISO(tz);
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
	let differentTz = $derived(data.organizerTz !== browserTz);
</script>

<svelte:head>
	<title>Booking {data.appointment.id.slice(0, 8)} — Admin</title>
</svelte:head>

<div class="page">
	<nav class="breadcrumbs">
		<a href="/admin">← All bookings</a>
	</nav>

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
	</header>

	{#if data.appointment.notification_status}
		<aside class="notif-warning">
			<IconWarning class="notif-icon" aria-hidden="true" />
			<div>
				<p class="notif-title">Some notifications didn't send</p>
				<p class="notif-detail">{data.appointment.notification_status}</p>
			</div>
		</aside>
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
					<div class="detail-primary">
						{fmtDateShort(data.appointment.start_time, data.organizerTz)}
					</div>
					<div class="detail-secondary">
						{fmtWeekday(data.appointment.start_time, data.organizerTz)}
					</div>
				</div>
			</div>
			<div class="detail-row">
				<IconClock class="detail-icon" aria-hidden="true" />
				<div class="detail-text">
					<div class="detail-primary">
						{fmtTimeRange(data.appointment.start_time, data.appointment.end_time, data.organizerTz)}
					</div>
					<div class="detail-secondary">{fmtTzShort(data.organizerTz)}</div>
					{#if differentTz}
						<div class="detail-secondary tz-extra">
							{fmtTimeRange(data.appointment.start_time, data.appointment.end_time, browserTz)}
							&middot; {fmtTzShort(browserTz)}
						</div>
					{/if}
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
					<div class="detail-secondary">{data.appointment.attendee_email}</div>
				</div>
			</div>
			{#if data.appointment.attendee_notes}
				<div class="detail-row">
					<IconNote class="detail-icon" aria-hidden="true" />
					<div class="detail-text">
						<div class="detail-primary">Notes</div>
						<div class="detail-secondary notes">{data.appointment.attendee_notes}</div>
					</div>
				</div>
			{/if}
		</section>
	</article>

	<!-- Actions land in commits 6–8. -->
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--space-7) var(--space-6) var(--space-9);
		color: var(--text);
	}

	.breadcrumbs {
		font-size: var(--font-size-sm);
		margin: 0 0 var(--space-5);
	}

	.breadcrumbs a {
		color: var(--text-muted);
		text-decoration: none;
	}

	.breadcrumbs a:hover {
		color: var(--text);
	}

	.status-banner {
		margin: 0 0 var(--space-5);
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

	.notif-warning {
		display: flex;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		background: var(--warning-bg, var(--surface-muted));
		border: 1px solid var(--warning-border, var(--border-strong));
		border-radius: var(--radius);
		margin: 0 0 var(--space-5);
		color: var(--warning, var(--text));
	}

	:global(.notif-icon) {
		font-size: var(--font-size-lg);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.notif-title {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 600;
	}

	.notif-detail {
		margin: 0;
		font-size: var(--font-size-xs);
		font-family: var(--font-mono, monospace);
		word-break: break-all;
		color: var(--text-muted);
	}

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

	.tz-extra {
		margin-top: var(--space-2);
		font-style: italic;
	}

	.notes {
		white-space: pre-wrap;
		line-height: 1.5;
	}

	@media (max-width: 768px) {
		.page {
			padding: var(--space-5) var(--space-5) var(--space-8);
		}

		.card-section {
			padding: var(--space-5) var(--space-5);
		}
	}
</style>
