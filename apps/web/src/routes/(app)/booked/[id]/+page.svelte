<script lang="ts">
	import { onMount } from 'svelte';
	import { Dialog } from 'bits-ui';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconCheckCircle from 'virtual:icons/ph/check-circle';
	import IconCalendarPlus from 'virtual:icons/ph/calendar-plus';
	import IconClock from 'virtual:icons/ph/clock';
	import IconMapPin from 'virtual:icons/ph/map-pin';
	import IconUser from 'virtual:icons/ph/user';
	import IconEnvelopeSimple from 'virtual:icons/ph/envelope-simple';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconUserGear from 'virtual:icons/ph/user-gear';
	import IconNote from 'virtual:icons/ph/note';
	import NotificationChips from '$lib/components/NotificationChips.svelte';
	import { formatDateShort, formatWeekday, formatTimeRange, formatTzShort } from '$lib/datetime';

	let { data, form } = $props();

	let userTz = $state('UTC');
	// Writable derived: tracks the server's `cancel=1` flag but can be toggled
	// locally to open/close the dialog.
	let cancelDialogOpen = $derived(data.showCancelModal);

	onMount(() => {
		userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	});

	let status = $derived(data.appointment.status);
	// The card's single state line: status wins for non-confirmed bookings; for
	// confirmed ones the time position (upcoming/in progress/concluded) leads.
	let stateTone = $derived(
		status === 'declined'
			? 'danger'
			: status === 'pending'
				? 'warning'
				: status === 'cancelled' || status === 'expired'
					? 'muted'
					: data.clockStatus === 'in_progress'
						? 'active'
						: data.clockStatus === 'concluded'
							? 'muted'
							: 'primary'
	);
	let canRebook = $derived(status === 'declined' || status === 'cancelled' || status === 'expired');
	let differentTz = $derived(data.organizerTz !== userTz);
	// Organizer sees times in their own configured zone; attendees in the browser's.
	let displayTz = $derived(data.isAdmin ? data.organizerTz : userTz);
	let hasAdminActions = $derived(
		data.actions.accept.allowed ||
			data.actions.decline.allowed ||
			data.actions.cancel.allowed ||
			data.actions.reschedule.allowed
	);
</script>

<svelte:head>
	{#if status === 'cancelled'}
		<title>Booking cancelled — When</title>
	{:else if status === 'expired'}
		<title>Booking expired — When</title>
	{:else if status === 'declined'}
		<title>Booking declined — When</title>
	{:else if status === 'pending'}
		<title>Booking requested — When</title>
	{:else}
		<title>Booking confirmed — When</title>
	{/if}
</svelte:head>

<div class="page">
	{#if data.isAdmin}
		<nav class="org-bar">
			<a class="org-bar-back" href="/admin">← All bookings</a>
			<span class="org-bar-badge">
				<IconUserGear class="org-bar-badge-icon" aria-hidden="true" />
				Organizer view
			</span>
		</nav>
	{/if}

	{#if data.justRescheduled}
		<aside class="banner banner-success">
			<IconCheckCircle class="banner-icon" aria-hidden="true" />
			<p class="banner-text">Your booking has been rescheduled.</p>
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

		<section class="card-section card-state state-{stateTone}">
			<span class="state-dot" aria-hidden="true"></span>
			<span class="state-text">
				{#if status === 'confirmed'}
					{#if data.clockStatus === 'upcoming'}Upcoming
					{:else if data.clockStatus === 'in_progress'}In progress
					{:else}Concluded{/if}
				{:else if status === 'pending'}
					Pending · waiting for {data.user.name}
				{:else if status === 'declined'}
					Declined by {data.user.name}
				{:else if status === 'expired'}
					Expired
				{:else}
					Cancelled
				{/if}
			</span>
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
						{formatTzShort(displayTz)}
					</div>
					{#if data.isAdmin && differentTz}
						<div class="detail-secondary tz-extra">
							{formatTimeRange(data.appointment.start_time, data.appointment.end_time, userTz)}
							&middot; {formatTzShort(userTz)} (local)
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
						{#if data.isAdmin}
							Attendee
						{:else}
							Attendee (you)
						{/if}
					</div>
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

	{#if form?.error}
		<aside class="banner banner-danger" role="alert">
			<IconWarningCircle class="banner-icon" aria-hidden="true" />
			<p class="banner-text">{form.error}</p>
		</aside>
	{:else if form?.success}
		<aside class="banner banner-success">
			<IconCheckCircle class="banner-icon" aria-hidden="true" />
			<p class="banner-text">The attendee has been notified.</p>
		</aside>
	{/if}

	{#if data.isAdmin}
		<section class="org-panel">
			<header class="org-panel-header">
				<IconUserGear class="org-panel-icon" aria-hidden="true" />
				<h2 class="org-panel-title">Organizer</h2>
			</header>

			<div class="org-section">
				<p class="org-section-label">Attendee</p>
				<div class="detail-list">
					<div class="detail-row">
						<IconEnvelopeSimple class="detail-icon" aria-hidden="true" />
						<div class="detail-text">
							<div class="detail-primary">{data.appointment.attendee_email}</div>
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
				</div>
			</div>

			{#if data.appointment.notifications.length > 0}
				{@const hasFailure = data.appointment.notifications.some((n) => n.state === 'failed')}
				<div class="org-section">
					<p class="org-section-label">Notifications</p>
					<div class="notif-chips">
						<NotificationChips notifications={data.appointment.notifications} />
					</div>
					{#if hasFailure}
						<p class="org-note org-note-warning">Some notifications didn't send.</p>
					{/if}
				</div>
			{/if}

			{#if hasAdminActions}
				<div class="org-section">
					<p class="org-section-label">Actions</p>
					<div class="actions-row">
						{#if data.actions.accept.allowed}
							<form method="POST" action="?/accept">
								<button type="submit" class="action-btn accept-btn"> Accept </button>
							</form>
						{/if}
						{#if data.actions.decline.allowed}
							<form method="POST" action="?/decline">
								<button type="submit" class="action-btn decline-btn"> Decline </button>
							</form>
						{/if}
						{#if data.actions.reschedule.allowed}
							<a
								class="action-btn reschedule-btn"
								href="/booked/{data.appointment.id}/reschedule?token={encodeURIComponent(
									data.token
								)}"
							>
								Reschedule
							</a>
						{/if}
						{#if data.actions.cancel.allowed}
							<button
								type="button"
								class="action-btn cancel-btn"
								onclick={() => (cancelDialogOpen = true)}
							>
								Cancel
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</section>
	{:else}
		{#if data.actions.reschedule.allowed || data.actions.cancel.allowed}
			<section class="changes">
				<header class="changes-header">
					<h2 class="changes-title">Change of plans?</h2>
				</header>
				<div class="changes-links">
					{#if data.actions.reschedule.allowed}
						<a
							class="changes-link changes-link-reschedule"
							href="/booked/{data.appointment.id}/reschedule?token={encodeURIComponent(data.token)}"
						>
							Reschedule
						</a>
					{/if}
					{#if data.actions.cancel.allowed}
						<button
							type="button"
							class="changes-link changes-link-cancel"
							onclick={() => (cancelDialogOpen = true)}
						>
							Cancel
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
		padding: var(--space-8) var(--space-6) var(--space-10);
		color: var(--text);
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

	.banner-success {
		background: var(--success-bg);
		border-color: var(--success-border);
	}

	.banner-success :global(.banner-icon) {
		color: var(--success);
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
	}

	/* ---- state stripe (the booking's single state line) ---- */
	.card-state {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-7);
		font-size: var(--font-size-md);
		font-weight: 600;
	}

	.state-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-pill);
		background: currentColor;
		flex-shrink: 0;
	}

	.state-primary {
		background: var(--primary-muted);
		color: var(--primary);
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

	.state-muted {
		background: var(--surface-muted);
		color: var(--text-muted);
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
		padding: var(--space-3) var(--space-6);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		text-decoration: none;
		font-size: var(--font-size-md);
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

	/* ---- organizer (admin) ---- */
	.org-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		margin: 0 0 var(--space-6);
		padding-bottom: var(--space-4);
		border-bottom: 1px solid var(--border);
	}

	.org-bar-back {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		text-decoration: none;
	}

	.org-bar-back:hover {
		color: var(--text);
	}

	.org-bar-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-3);
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
		background: var(--surface-muted);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
	}

	:global(.org-bar-badge-icon) {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
	}

	.org-panel {
		margin-top: var(--space-7);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.org-panel-header {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-6);
		background: var(--surface-muted);
		border-bottom: 1px solid var(--border-strong);
	}

	:global(.org-panel-icon) {
		font-size: var(--font-size-lg);
		color: var(--text-muted);
	}

	.org-panel-title {
		margin: 0;
		font-size: var(--font-size-sm);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}

	.org-section {
		padding: var(--space-5) var(--space-6);
	}

	.org-section + .org-section {
		border-top: 1px solid var(--border);
	}

	.org-section-label {
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text-muted);
	}

	.org-note {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
	}

	.org-note-warning {
		color: var(--warning-strong);
	}

	.notif-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}

	.tz-extra {
		margin-top: var(--space-2);
		font-style: italic;
	}

	.notes {
		white-space: pre-wrap;
		line-height: 1.5;
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

	.reschedule-btn {
		background: transparent;
		color: var(--text);
		border-color: var(--border-strong);
		text-decoration: none;
	}

	.reschedule-btn:hover {
		background: var(--surface-muted);
		border-color: var(--primary);
	}
</style>
