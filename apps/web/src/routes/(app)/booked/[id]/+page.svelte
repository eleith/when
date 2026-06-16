<script lang="ts">
	import { Dialog } from 'bits-ui';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconArrowUpLeft from 'virtual:icons/ph/arrow-up-left';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconClock from 'virtual:icons/ph/clock';
	import IconMapPin from 'virtual:icons/ph/map-pin';
	import IconUser from 'virtual:icons/ph/user';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconNote from 'virtual:icons/ph/note';
	import BookingActions from '$lib/components/BookingActions.svelte';
	import AddToCalendar from '$lib/components/AddToCalendar.svelte';
	import { formatDateShort, formatWeekday, formatTimeRange, formatTzShort } from '$lib/datetime';

	let { data, form } = $props();

	// Writable derived: tracks the server's `cancel=1` flag but can be toggled
	// locally to open/close the dialog.
	let cancelDialogOpen = $derived(data.showCancelModal);

	let status = $derived(data.appointment.status);
	// The card's single state line: status wins for non-confirmed bookings; for
	// confirmed ones the time position (upcoming/in progress/concluded) leads.
	let stateTone = $derived.by(() => {
		if (status === 'declined' || status === 'cancelled' || status === 'expired') return 'danger';
		if (status === 'rescheduled') return 'quiet';
		if (status === 'pending') return 'warning';
		if (data.clockStatus === 'in_progress') return 'active';
		if (data.clockStatus === 'concluded') return 'quiet';
		return 'info';
	});
	let canRebook = $derived(status === 'declined' || status === 'cancelled' || status === 'expired');
	// Each viewer's own zone leads; the counterpart's zone is shown when they differ.
	let displayTz = $derived(data.isAdmin ? data.organizerTz : data.attendeeTz);
	let counterpartTz = $derived(data.isAdmin ? data.attendeeTz : data.organizerTz);
	let counterpartName = $derived(data.isAdmin ? data.appointment.attendee_name : data.user.name);
	let zonesDiffer = $derived(displayTz !== counterpartTz);
	// The kebab now only carries reschedule/cancel; accept/decline moved to the CTA.
	let hasActions = $derived(data.actions.cancel.allowed || data.actions.reschedule.allowed);
	// Pending bookings have no calendar links, so the CTA slot is free for the decision.
	let showDecideCta = $derived(
		!data.calendarLinks && (data.actions.accept.allowed || data.actions.decline.allowed)
	);
	let notifFailed = $derived(data.appointment.notifications.some((n) => n.state === 'failed'));
	let notifLabel = $derived(
		notifFailed
			? 'notification failed'
			: data.appointment.notifications.some((n) => n.state === 'queued')
				? 'notification sending'
				: 'notification sent'
	);
</script>

<svelte:head>
	{#if status === 'cancelled'}
		<title>Booking cancelled — When</title>
	{:else if status === 'expired'}
		<title>Booking expired — When</title>
	{:else if status === 'declined'}
		<title>Booking declined — When</title>
	{:else if status === 'rescheduled'}
		<title>Booking rescheduled — When</title>
	{:else if status === 'pending'}
		<title>Booking requested — When</title>
	{:else}
		<title>Booking confirmed — When</title>
	{/if}
</svelte:head>

<header class="page-nav">
	{#if data.isAdmin}
		<a class="nav-back" href="/admin" aria-label="All bookings">
			<IconArrowUpLeft class="nav-back-icon" aria-hidden="true" />
		</a>
	{/if}
</header>

<div class="page" class:has-cta={!!data.calendarLinks || showDecideCta}>
	{#if form?.error}
		<aside class="banner banner-danger" role="alert">
			<IconWarningCircle class="banner-icon" aria-hidden="true" />
			<p class="banner-text">{form.error}</p>
		</aside>
	{/if}

	<article class="card">
		<section class="card-section card-section-header">
			<div class="event-heading">
				<h1 class="event-name">{data.eventType.name}</h1>
				<p class="event-meta">
					{data.eventType.duration} min{#if data.eventType.description}
						&middot; {data.eventType.description}{/if}
				</p>
			</div>
			{#if hasActions}
				<BookingActions
					actions={data.actions}
					appointmentId={data.appointment.id}
					token={data.token}
					onCancel={() => (cancelDialogOpen = true)}
				/>
			{/if}
		</section>

		<section class="card-section card-state state-{stateTone}">
			<span class="state-dot" aria-hidden="true"></span>
			<span class="state-text">
				{#if status === 'confirmed'}
					{#if data.clockStatus === 'upcoming'}Upcoming
					{:else if data.clockStatus === 'in_progress'}In progress
					{:else}Concluded{/if}
				{:else if status === 'pending'}
					Pending · waiting for {#if data.isAdmin}you{:else}{data.user.name}{/if}
				{:else if status === 'declined'}
					Declined by {data.user.name}
				{:else if status === 'expired'}
					Expired
				{:else if status === 'rescheduled'}
					Rescheduled
				{:else}
					Cancelled
				{/if}
			</span>
			{#if data.rescheduledFrom || data.latestBooking}
				<span class="state-meta">
					{#if data.rescheduledFrom}
						Rescheduled from
						<a
							class="state-meta-link"
							href="/booked/{data.rescheduledFrom.id}?token={encodeURIComponent(
								data.rescheduledFrom.token
							)}"
						>
							{formatDateShort(data.rescheduledFrom.start_time, displayTz)}
						</a>
					{/if}
					{#if data.rescheduledFrom && data.latestBooking}&nbsp;·&nbsp;{/if}
					{#if data.latestBooking}
						<a
							class="state-meta-link"
							href="/booked/{data.latestBooking.id}?token={encodeURIComponent(
								data.latestBooking.token
							)}"
						>
							View latest booking
						</a>
					{/if}
				</span>
			{/if}
		</section>

		<section class="card-section detail-list">
			<div class="detail-row">
				<IconCalendarBlank class="detail-icon" aria-hidden="true" />
				<div class="detail-text">
					<div class="detail-primary">
						{formatDateShort(data.appointment.start_time, displayTz)}
					</div>
					<div class="detail-secondary">
						{formatWeekday(data.appointment.start_time, displayTz)}
					</div>
				</div>
			</div>
			<div class="detail-row">
				<IconClock class="detail-icon" aria-hidden="true" />
				<div class="detail-text">
					<div class="detail-primary">
						{formatTimeRange(data.appointment.start_time, data.appointment.end_time, displayTz)}
					</div>
					<div class="detail-secondary">
						{formatTzShort(displayTz)}{#if zonesDiffer}&nbsp;&middot; you{/if}
					</div>
					{#if zonesDiffer}
						<div class="detail-secondary tz-extra">
							{formatTimeRange(
								data.appointment.start_time,
								data.appointment.end_time,
								counterpartTz
							)}
							&middot; {formatTzShort(counterpartTz)} &middot; {counterpartName}
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
					<div class="detail-secondary">
						{#if data.isAdmin}Attendee{:else}Attendee (you){/if}
					</div>
					{#if data.isAdmin}
						<div class="detail-secondary">{data.appointment.attendee_email}</div>
						<div class="detail-secondary" class:notif-failed={notifFailed}>{notifLabel}</div>
					{/if}
				</div>
			</div>
			<div class="detail-row">
				<IconUser class="detail-icon" aria-hidden="true" />
				<div class="detail-text">
					<div class="detail-primary">{data.user.name}</div>
					<div class="detail-secondary">
						{#if data.isAdmin}
							Attendee (you)
						{:else}
							Attendee
						{/if}
					</div>
				</div>
			</div>
			{#if data.isAdmin && data.appointment.attendee_notes}
				<div class="detail-row">
					<IconNote class="detail-icon" aria-hidden="true" />
					<div class="detail-text">
						<div class="detail-primary">Notes</div>
						<div class="detail-secondary notes">{data.appointment.attendee_notes}</div>
					</div>
				</div>
			{/if}
		</section>

		{#if data.calendarLinks}
			<section class="card-section card-cta">
				<AddToCalendar links={data.calendarLinks} appointmentId={data.appointment.id} />
			</section>
		{:else if showDecideCta}
			<section class="card-section card-cta decide-cta">
				{#if data.actions.decline.allowed}
					<form method="POST" action="?/decline" class="decide-form">
						<button type="submit" class="decide-btn decide-decline">Decline</button>
					</form>
				{/if}
				{#if data.actions.accept.allowed}
					<form method="POST" action="?/accept" class="decide-form">
						<button type="submit" class="decide-btn decide-accept">Accept</button>
					</form>
				{/if}
			</section>
		{/if}
	</article>

	{#if !data.isAdmin && canRebook}
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
			<Dialog.Title class="cancel-dialog-title">Cancel booking?</Dialog.Title>

			<p class="cancel-dialog-desc">
				{#if data.isAdmin}
					<strong>{data.appointment.attendee_name}</strong> will be notified by email. This can't be undone.
				{:else}
					You'll both be notified by email. This can't be undone.
				{/if}
			</p>

			<form method="POST" action="?/cancel" class="cancel-dialog-actions">
				<input type="hidden" name="token" value={data.token} />
				<button type="submit" class="cancel-confirm-btn">Yes, cancel</button>
				<Dialog.Close type="button" class="cancel-cancel-btn">No, keep</Dialog.Close>
			</form>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.page {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-6) var(--space-10);
		color: var(--text);
	}

	/* Full-bleed page nav; empty for attendees, holds the back arrow for admins. */
	.page-nav {
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 var(--space-6);
	}

	.nav-back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		margin-left: calc(var(--space-2) * -1);
		border-radius: var(--radius-pill);
		color: var(--text-secondary);
		transition:
			background var(--transition),
			color var(--transition);
	}

	.nav-back:hover {
		background: var(--surface-muted);
		color: var(--text);
	}

	:global(.nav-back-icon) {
		font-size: var(--font-size-xl);
	}

	/* ---- banners (notices & confirmations) ---- */
	.banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		border: 1px solid;
		border-radius: var(--radius-md);
		margin: var(--space-4) 0;
		color: var(--text-secondary);
		font-size: var(--font-size-md);
		line-height: 1.5;
	}

	:global(.banner-icon) {
		font-size: var(--font-size-xl);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.banner-text {
		margin: 0;
	}

	.banner-danger {
		background: var(--danger-bg);
		border-color: var(--danger-border);
	}

	.banner-danger :global(.banner-icon) {
		color: var(--danger);
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
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.event-heading {
		min-width: 0;
	}

	/* ---- state stripe (the booking's single state line) ---- */
	.card-state {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-7);
		font-size: var(--font-size-lg);
		font-weight: 600;
	}

	.state-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-pill);
		background: currentColor;
		flex-shrink: 0;
	}

	.state-meta {
		margin-left: auto;
		font-size: var(--font-size-base);
		font-weight: 500;
	}

	.state-meta-link {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.state-meta-link:hover {
		text-decoration: none;
	}

	.state-info {
		background: var(--info-bg);
		color: var(--info-strong);
	}

	.state-active {
		background: var(--success-bg);
		color: var(--success-strong);
	}

	.state-warning {
		background: var(--warning-bg);
		color: var(--warning-strong);
	}

	.state-danger {
		background: var(--danger-bg);
		color: var(--danger-strong);
	}

	.state-quiet {
		background: var(--quiet-bg);
		color: var(--quiet-strong);
	}

	.event-name {
		font-size: var(--font-size-2xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
	}

	.event-meta {
		color: var(--text-muted);
		font-size: var(--font-size-base);
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
		font-size: var(--font-size-xl);
		color: var(--text-muted);
		flex-shrink: 0;
		margin-top: 1px;
	}

	.detail-text {
		min-width: 0;
	}

	.detail-primary {
		color: var(--text);
		font-weight: 500;
		font-size: var(--font-size-lg);
		line-height: 1.4;
	}

	.detail-secondary {
		color: var(--text-muted);
		font-size: var(--font-size-base);
		margin-top: 2px;
	}

	:global(.action-arrow) {
		display: inline-block;
		transition: transform var(--transition);
	}

	.notif-failed {
		color: var(--danger-strong);
	}

	/* ---- accept / decline CTA (pending, organizer) ---- */
	.decide-cta {
		display: flex;
		gap: var(--space-4);
	}

	.decide-form {
		flex: 1;
	}

	.decide-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 48px;
		padding: var(--space-4) var(--space-6);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition:
			opacity var(--transition),
			background var(--transition),
			border-color var(--transition);
	}

	.decide-accept {
		border: none;
		background: var(--primary);
		color: var(--text-on-primary);
	}

	.decide-accept:hover {
		opacity: 0.9;
	}

	.decide-decline {
		border: 1px solid var(--border-strong);
		background: var(--surface);
		color: var(--text-secondary);
	}

	.decide-decline:hover {
		background: var(--danger-bg);
		border-color: var(--danger-border);
		color: var(--danger-strong);
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

		.page-nav {
			padding: 0 var(--space-5);
		}

		.page.has-cta {
			padding-bottom: calc(var(--space-10) + var(--space-8) + env(safe-area-inset-bottom));
		}

		.card-section {
			padding: var(--space-5) var(--space-5);
		}

		.card-cta {
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			z-index: 50;
			padding: var(--space-4) var(--space-5);
			padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
			background: var(--surface);
			border-top: 1px solid var(--border);
			box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
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
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
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

	:global(.cancel-dialog-title) {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: 700;
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

	.tz-extra {
		margin-top: var(--space-2);
	}

	.notes {
		white-space: pre-wrap;
		line-height: 1.5;
	}
</style>
