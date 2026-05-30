<script lang="ts">
	import { onMount } from 'svelte';
	import { Temporal } from '@js-temporal/polyfill';
	import { Dialog } from 'bits-ui';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconCheckCircle from 'virtual:icons/ph/check-circle';
	import IconCalendarPlus from 'virtual:icons/ph/calendar-plus';
	import IconClock from 'virtual:icons/ph/clock';
	import IconMapPin from 'virtual:icons/ph/map-pin';
	import IconPencilSimple from 'virtual:icons/ph/pencil-simple';
	import IconUser from 'virtual:icons/ph/user';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';

	let { data } = $props();

	let userTz = $state('UTC');
	let cancelDialogOpen = $state(false);

	$effect(() => {
		cancelDialogOpen = data.showCancelModal;
	});

	onMount(() => {
		userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	});

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

	{#if data.justRescheduled}
		<aside class="flash">
			<IconCheckCircle class="flash-icon" aria-hidden="true" />
			<p class="flash-text">Your booking has been rescheduled.</p>
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
						href="/schedule/{data.eventType.slug}?reschedule={data.appointment
							.id}&token={encodeURIComponent(data.token)}"
					>
						Reschedule
						<IconArrowRight class="action-arrow" aria-hidden="true" />
					</a>
				{/if}
				{#if data.actions.cancel.allowed}
					<button
						type="button"
						class="changes-link changes-link-cancel"
						onclick={() => (cancelDialogOpen = true)}
					>
						Cancel booking
					</button>
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

<Dialog.Root bind:open={cancelDialogOpen}>
	<Dialog.Portal>
		<Dialog.Overlay class="dialog-overlay" />
		<Dialog.Content class="dialog-content cancel-dialog">
			<div class="cancel-dialog-header">
				<Dialog.Title class="cancel-dialog-title">Cancel booking?</Dialog.Title>
				<Dialog.Close class="cancel-dialog-close" aria-label="Close">&times;</Dialog.Close>
			</div>

			<aside class="warning-banner">
				<IconWarningCircle class="warning-icon" aria-hidden="true" />
				<p class="warning-text">
					This action cannot be undone. An email notification will be sent immediately.
				</p>
			</aside>

			<p class="cancel-dialog-desc">
				This will cancel the booking for <strong>{data.eventType.name}</strong> with
				<strong>{data.user.name}</strong> and notify both of you.
			</p>

			<form
				method="POST"
				action="/booked/{data.appointment.id}/cancel"
				class="cancel-dialog-actions"
			>
				<input type="hidden" name="token" value={data.token} />
				<button type="submit" class="cancel-confirm-btn">Yes, cancel booking</button>
				<Dialog.Close class="cancel-cancel-btn">Keep booking</Dialog.Close>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

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

	/* ---- flash banner ---- */
	.flash {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-5);
		background: var(--primary-muted);
		border: 1px solid var(--primary-border);
		border-radius: var(--radius);
		margin: 0 0 var(--space-4);
		color: var(--primary);
	}

	:global(.flash-icon) {
		font-size: var(--font-size-lg);
		flex-shrink: 0;
	}

	.flash-text {
		margin: 0;
		font-size: var(--font-size-sm);
		line-height: 1.5;
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
		background: transparent;
		cursor: pointer;
		font-family: inherit;
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

	/* ---- cancel dialog ---- */
	:global(.dialog-overlay) {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		z-index: 200;
		animation: cancel-fade-in 0.15s ease-out;
	}

	:global(.dialog-content.cancel-dialog) {
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
		padding: var(--space-6);
		gap: var(--space-5);
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
		animation: cancel-slide-up 0.2s ease-out;
	}

	@media (min-width: 769px) {
		:global(.dialog-content.cancel-dialog) {
			top: 50%;
			bottom: auto;
			left: 50%;
			right: auto;
			width: 440px;
			max-width: calc(100vw - var(--space-7) * 2);
			max-height: min(70vh, 520px);
			transform: translate(-50%, -50%);
			border: 1px solid var(--border);
			border-radius: var(--radius-md);
			animation: cancel-fade-up-desktop 0.2s ease-out;
		}
	}

	@keyframes cancel-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes cancel-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes cancel-fade-up-desktop {
		from {
			transform: translate(-50%, calc(-50% + 8px));
			opacity: 0;
		}
		to {
			transform: translate(-50%, -50%);
			opacity: 1;
		}
	}

	.cancel-dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	:global(.cancel-dialog-title) {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: 700;
	}

	:global(.cancel-dialog-close) {
		background: none;
		border: none;
		font-size: var(--font-size-2xl);
		line-height: 1;
		color: var(--text-muted);
		cursor: pointer;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	:global(.cancel-dialog-close:hover) {
		background: var(--surface-muted);
		color: var(--text);
	}

	/* ---- warning banner inside modal ---- */
	.warning-banner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		background: var(--danger-bg);
		border: 1px solid var(--danger-border);
		border-radius: var(--radius);
		color: var(--danger-strong);
	}

	:global(.warning-icon) {
		font-size: var(--font-size-lg);
		flex-shrink: 0;
	}

	.warning-text {
		margin: 0;
		font-size: var(--font-size-sm);
		line-height: 1.5;
		font-weight: 500;
	}

	.cancel-dialog-desc {
		color: var(--text-secondary);
		font-size: var(--font-size-md);
		line-height: 1.5;
		margin: 0;
	}

	.cancel-dialog-actions {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		margin-top: var(--space-2);
	}

	.cancel-confirm-btn {
		background: var(--danger);
		color: var(--text-on-primary);
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-6);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition:
			background var(--transition),
			border-color var(--transition);
	}

	.cancel-confirm-btn:hover {
		background: var(--danger-strong);
		border-color: var(--danger-strong);
	}

	:global(.cancel-cancel-btn) {
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-6);
		font-size: var(--font-size-md);
		font-weight: 600;
		color: var(--text);
		cursor: pointer;
		transition: background var(--transition);
	}

	:global(.cancel-cancel-btn:hover) {
		background: var(--surface-muted);
	}

	@media (max-width: 768px) {
		.cancel-dialog-actions {
			flex-direction: column;
			align-items: stretch;
			gap: var(--space-3);
		}

		.cancel-confirm-btn {
			width: 100%;
			text-align: center;
			min-height: 48px;
		}

		:global(.cancel-cancel-btn) {
			width: 100%;
			text-align: center;
			min-height: 48px;
		}
	}
</style>
