<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconClock from 'virtual:icons/ph/clock';
	import IconMapPin from 'virtual:icons/ph/map-pin';
	import IconNote from 'virtual:icons/ph/note';
	import IconUser from 'virtual:icons/ph/user';
	import IconWarning from 'virtual:icons/ph/warning';

	let { data, form } = $props();

	let acceptBtn = $state<HTMLButtonElement | null>(null);
	let declineBtn = $state<HTMLButtonElement | null>(null);
	let cancelBtn = $state<HTMLButtonElement | null>(null);
	let confirmCancel = $state(false);

	$effect(() => {
		if (data.focus === 'accept') acceptBtn?.focus();
		else if (data.focus === 'decline') declineBtn?.focus();
		else if (data.focus === 'cancel') cancelBtn?.focus();
	});

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
		{#if data.clockStatus}
			<p class="clock-label">
				{#if data.clockStatus === 'upcoming'}Upcoming
				{:else if data.clockStatus === 'in_progress'}In progress
				{:else}Concluded
				{/if}
			</p>
		{/if}
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

	{#if form?.error}
		<p class="form-error" role="alert">{form.error}</p>
	{:else if form?.success === 'accepted'}
		<p class="form-success">Accepted. The attendee has been notified.</p>
	{:else if form?.success === 'declined'}
		<p class="form-success">Declined. The attendee has been notified.</p>
	{:else if form?.success === 'cancelled'}
		<p class="form-success">Cancelled. The attendee has been notified.</p>
	{/if}

	{#if data.actions.accept.allowed || data.actions.decline.allowed || data.actions.cancel.allowed}
		<section class="actions">
			<header class="actions-header">
				<h2 class="actions-title">Actions</h2>
			</header>
			<div class="actions-row">
				{#if data.actions.accept.allowed}
					<form method="POST" action="?/accept">
						<button type="submit" class="action-btn accept-btn" bind:this={acceptBtn}>
							Accept
						</button>
					</form>
				{/if}
				{#if data.actions.decline.allowed}
					<form method="POST" action="?/decline">
						<button type="submit" class="action-btn decline-btn" bind:this={declineBtn}>
							Decline
						</button>
					</form>
				{/if}
				{#if data.actions.cancel.allowed && !confirmCancel}
					<button
						type="button"
						class="action-btn cancel-btn"
						bind:this={cancelBtn}
						onclick={() => (confirmCancel = true)}
					>
						Cancel booking
					</button>
				{/if}
			</div>

			{#if data.actions.cancel.allowed && confirmCancel}
				<div class="confirm-row" role="group" aria-label="Confirm cancellation">
					<p class="confirm-prompt">
						Cancel this booking? <strong>{data.appointment.attendee_name}</strong> will be notified.
					</p>
					<div class="actions-row">
						<form method="POST" action="?/cancel">
							<button type="submit" class="action-btn confirm-cancel-btn"> Yes, cancel </button>
						</form>
						<button
							type="button"
							class="action-btn keep-btn"
							onclick={() => (confirmCancel = false)}
						>
							Keep
						</button>
					</div>
				</div>
			{/if}
		</section>
	{/if}
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
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		margin: 0 0 var(--space-5);
	}

	.status-label {
		font-size: var(--font-size-2xl);
		font-weight: 700;
		margin: 0;
	}

	.clock-label {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		margin: 0;
		padding: 2px var(--space-3);
		background: var(--surface-muted);
		border-radius: var(--radius-pill);
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

	.form-error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: var(--space-3) var(--space-5);
		border-radius: var(--radius);
		font-size: var(--font-size-sm);
		margin: var(--space-5) 0 0;
	}

	.form-success {
		background: var(--primary-muted);
		color: var(--primary);
		padding: var(--space-3) var(--space-5);
		border-radius: var(--radius);
		font-size: var(--font-size-sm);
		margin: var(--space-5) 0 0;
	}

	/* ---- actions section ---- */
	.actions {
		margin-top: var(--space-7);
	}

	.actions-header {
		margin: 0 0 var(--space-4);
	}

	.actions-title {
		font-size: var(--font-size-md);
		font-weight: 600;
		margin: 0;
	}

	.actions-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		border: 1px solid;
		transition:
			background var(--transition),
			color var(--transition),
			border-color var(--transition);
	}

	.accept-btn {
		background: var(--primary);
		color: var(--text-on-primary);
		border-color: var(--primary);
	}

	.accept-btn:hover {
		opacity: 0.9;
	}

	.decline-btn,
	.cancel-btn {
		background: transparent;
		color: var(--danger);
		border-color: var(--border-strong);
	}

	.decline-btn:hover,
	.cancel-btn:hover {
		background: var(--danger-bg);
		border-color: var(--danger);
	}

	.confirm-row {
		margin-top: var(--space-5);
		padding: var(--space-5);
		background: var(--danger-bg);
		border: 1px solid var(--danger-border, var(--danger));
		border-radius: var(--radius);
	}

	.confirm-prompt {
		margin: 0 0 var(--space-4);
		color: var(--text);
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.confirm-cancel-btn {
		background: var(--danger);
		color: var(--text-on-primary);
		border-color: var(--danger);
	}

	.confirm-cancel-btn:hover {
		opacity: 0.9;
	}

	.keep-btn {
		background: var(--surface);
		color: var(--text);
		border-color: var(--border-strong);
	}

	.keep-btn:hover {
		background: var(--surface-muted);
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
