<script lang="ts">
	import { goto } from '$app/navigation';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconCheck from 'virtual:icons/ph/check';
	import IconX from 'virtual:icons/ph/x';
	import IconWarning from 'virtual:icons/ph/warning';
	import NotificationChips from '$lib/components/NotificationChips.svelte';

	let { data } = $props();

	let conflictCount = $derived(data.appointments.filter((a) => a.possible_conflict).length);
	let badCalendars = $derived(data.calendars.filter((c) => c.health === 'bad'));

	function fmt(iso: string): string {
		return new Date(iso).toLocaleString([], {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function handleRowClick(e: MouseEvent, id: string) {
		const target = e.target as HTMLElement;
		// Prevent navigating if the user clicked on an interactive element (e.g. form, button, link)
		if (
			target.closest('.cell-actions') ||
			target.closest('a') ||
			target.closest('button') ||
			target.closest('form')
		) {
			return;
		}
		goto(`/booked/${id}`);
	}
</script>

<svelte:head>
	<title>Bookings — When</title>
</svelte:head>

<div class="section-header">
	<h1 class="page-title">Bookings</h1>
	<p class="page-subtitle">Manage appointments and requests</p>
</div>

{#if conflictCount > 0}
	<div class="review-banner" role="alert">
		<IconWarning class="review-icon" aria-hidden="true" />
		<span>
			{conflictCount} possible conflict{#if conflictCount !== 1}s{/if} — please review.
		</span>
	</div>
{/if}

{#if badCalendars.length > 0}
	<div class="review-banner" role="alert">
		<IconWarning class="review-icon" aria-hidden="true" />
		<div class="health-banner-body">
			<strong>Calendar sync problem.</strong>
			<ul class="health-list">
				{#each badCalendars as c (c.id)}
					<li><span class="health-cal">{c.id}</span> — {c.reason ?? 'not syncing'}</li>
				{/each}
			</ul>
		</div>
	</div>
{/if}

{#if data.appointments.length === 0}
	<div class="card empty-card">
		<IconCalendarBlank class="empty-icon" aria-hidden="true" />
		<p class="empty-text">No appointments scheduled yet.</p>
	</div>
{:else}
	<div class="card table-card">
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Attendee</th>
						<th>Event type</th>
						<th>Date & Time</th>
						<th>Status</th>
						<th class="actions-th">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.appointments as a (a.id)}
						<tr class:past={a.is_past} onclick={(e) => handleRowClick(e, a.id)}>
							<td class="cell-attendee">
								<div class="attendee-info">
									<a href="/booked/{a.id}" class="row-link">{a.attendee_name}</a>
									<span class="attendee-email">
										{a.attendee_email}
									</span>
								</div>
							</td>
							<td class="cell-event">
								<span class="event-tag">{a.event_type_name}</span>
							</td>
							<td class="cell-time">
								<span class="time-text">{fmt(a.start_time)}</span>
							</td>
							<td class="cell-status">
								<div class="status-wrapper">
									<span class="status-badge status-{a.display_status}">
										{#if a.display_status === 'in_progress'}
											in progress
										{:else}
											{a.display_status}
										{/if}
									</span>
									{#if a.notifications.length > 0}
										<NotificationChips notifications={a.notifications} />
									{/if}
									{#if a.possible_conflict}
										<span
											class="conflict-chip"
											title="This time overlaps a busy event on a conflict calendar"
										>
											<IconWarning class="conflict-icon" aria-hidden="true" />
											Conflict
										</span>
									{/if}
								</div>
							</td>
							<td class="cell-actions">
								{#if a.status === 'pending' && !a.is_past}
									<div class="action-buttons">
										<form method="POST" action="/booked/{a.id}?/accept" class="action-form">
											<button type="submit" class="action-btn accept" title="Accept Booking">
												<IconCheck class="action-icon" aria-hidden="true" />
												<span>Accept</span>
											</button>
										</form>
										<form method="POST" action="/booked/{a.id}?/decline" class="action-form">
											<button type="submit" class="action-btn decline" title="Decline Booking">
												<IconX class="action-icon" aria-hidden="true" />
												<span>Decline</span>
											</button>
										</form>
									</div>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

<style>
	.section-header {
		margin-bottom: var(--space-6);
	}

	.page-title {
		font-size: var(--font-size-2xl);
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 var(--space-1);
	}

	.page-subtitle {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		margin: 0;
	}

	/* ---- card styling ---- */
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.empty-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-10) var(--space-6);
		text-align: center;
		gap: var(--space-4);
	}

	:global(.empty-icon) {
		font-size: var(--font-size-3xl);
		color: var(--text-disabled);
	}

	.empty-text {
		font-size: var(--font-size-md);
		color: var(--text-muted);
		margin: 0;
	}

	/* ---- table design ---- */
	.table-card {
		border-radius: var(--radius-md);
	}

	.table-wrap {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
	}

	th {
		background: var(--surface-page);
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--border);
	}

	td {
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
		font-size: var(--font-size-base);
	}

	tr:last-child td {
		border-bottom: none;
	}

	tr {
		cursor: pointer;
		transition: background var(--transition);
	}

	tr:hover {
		background: var(--surface-page);
	}

	/* rows styling for past events */
	tr.past td {
		color: var(--text-disabled);
	}

	tr.past .row-link {
		color: var(--text-secondary);
		font-weight: 500;
	}

	tr.past .event-tag {
		background: var(--surface-muted);
		color: var(--text-disabled);
	}

	/* cell specifics */
	.attendee-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.row-link {
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
		font-size: var(--font-size-md);
	}

	.attendee-email {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--text-muted);
	}

	:global(.cell-icon) {
		font-size: var(--font-size-xs);
		color: var(--text-disabled);
	}

	.event-tag {
		display: inline-block;
		font-size: var(--font-size-xs);
		font-weight: 600;
		background: var(--surface-muted);
		color: var(--text-secondary);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.time-text {
		font-weight: 500;
		font-size: var(--font-size-sm);
	}

	.review-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--warning) 12%, transparent);
		color: var(--warning);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}

	.review-banner:has(.health-banner-body) {
		align-items: flex-start;
	}

	.health-banner-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.health-list {
		margin: 0;
		padding-left: var(--space-4);
		font-weight: 500;
	}

	.health-cal {
		font-weight: 700;
	}

	.status-wrapper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.conflict-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		font-weight: 600;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--warning) 12%, transparent);
		color: var(--warning);
		white-space: nowrap;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		font-size: var(--font-size-xs);
		font-weight: 700;
		text-transform: capitalize;
		padding: var(--space-1) var(--space-2_5, 8px);
		border-radius: var(--radius-pill);
		line-height: 1;
	}

	.status-confirmed {
		background: var(--info-bg);
		color: var(--info-strong);
	}

	.status-in_progress {
		background: var(--success-bg);
		color: var(--success-strong);
	}

	.status-pending {
		background: var(--warning-bg);
		color: var(--warning-strong);
	}

	.status-concluded,
	.status-cancelled,
	.status-expired {
		background: var(--quiet-bg);
		color: var(--quiet-strong);
	}

	.status-declined {
		background: var(--danger-bg);
		color: var(--danger-strong);
	}

	/* actions alignment */
	.actions-th,
	.cell-actions {
		text-align: right;
	}

	.action-buttons {
		display: inline-flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.action-form {
		margin: 0;
		display: inline-block;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		font-weight: 700;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
		transition:
			background var(--transition),
			border-color var(--transition),
			color var(--transition);
	}

	.action-btn.accept {
		background: var(--success-bg);
		color: var(--success-strong);
		border-color: var(--success-border);
	}

	.action-btn.accept:hover {
		background: var(--success);
		color: var(--text-on-primary);
		border-color: var(--success);
	}

	.action-btn.decline {
		background: var(--danger-bg);
		color: var(--danger-strong);
		border-color: var(--danger-border);
	}

	.action-btn.decline:hover {
		background: var(--danger);
		color: var(--text-on-primary);
		border-color: var(--danger);
	}

	:global(.action-icon) {
		font-size: var(--font-size-xs);
	}

	/* ---- responsive overrides ---- */
	@media (max-width: 768px) {
		th,
		td {
			padding: var(--space-3) var(--space-4);
		}

		.action-btn span {
			display: none;
		}
	}
</style>
