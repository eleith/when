<script lang="ts">
	import { goto } from '$app/navigation';
	import IconWarning from 'virtual:icons/ph/warning';
	import NotificationChips from '$lib/components/NotificationChips.svelte';
	import type { toAppointmentView } from '$lib/server/appointments';

	interface Props {
		appointments: ReturnType<typeof toAppointmentView>[];
	}

	let { appointments }: Props = $props();

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
		// Prevent navigating if the user clicked on a link
		if (target.closest('a')) {
			return;
		}
		goto(`/booked/${id}`);
	}
</script>

<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th>Attendee</th>
				<th>Event type</th>
				<th>Date & Time</th>
				<th>Status</th>
			</tr>
		</thead>
		<tbody>
			{#each appointments as a (a.id)}
				<tr class:past={a.is_past} onclick={(e) => handleRowClick(e, a.id)}>
					<td class="cell-attendee">
						<div class="attendee-info">
							<a href="/booked/{a.id}" class="row-link">{a.attendee_name}</a>
							<span class="attendee-email" class:no-email={!a.attendee_email}>
								{a.attendee_email ?? 'No email'}
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
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
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
		font-size: var(--font-size-sm);
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
		font-size: var(--font-size-md);
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
		font-size: var(--font-size-lg);
	}

	.attendee-email {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--text-muted);
	}

	.attendee-email.no-email {
		font-style: italic;
		opacity: 0.7;
	}

	.event-tag {
		display: inline-block;
		font-size: var(--font-size-sm);
		font-weight: 600;
		background: var(--surface-muted);
		color: var(--text-secondary);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.time-text {
		font-weight: 500;
		font-size: var(--font-size-base);
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
		font-size: var(--font-size-sm);
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
		font-size: var(--font-size-sm);
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
	.status-rescheduled {
		background: var(--quiet-bg);
		color: var(--quiet-strong);
	}

	.status-declined,
	.status-cancelled,
	.status-expired {
		background: var(--danger-bg);
		color: var(--danger-strong);
	}

	/* ---- responsive overrides ---- */
	@media (max-width: 768px) {
		th,
		td {
			padding: var(--space-3) var(--space-4);
		}
	}
</style>
