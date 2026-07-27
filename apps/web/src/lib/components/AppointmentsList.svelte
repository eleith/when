<script lang="ts">
	import IconWarning from 'virtual:icons/ph/warning';
	import type { toAppointmentView } from '$lib/server/appointments';
	import AppointmentsBulkActions from '$lib/components/AppointmentsBulkActions.svelte';
	import AppointmentsBulkDialog from '$lib/components/AppointmentsBulkDialog.svelte';

	interface Props {
		appointments: ReturnType<typeof toAppointmentView>[];
		bucket?: 'upcoming' | 'pending' | 'past' | 'purged';
	}

	let { appointments, bucket = 'upcoming' }: Props = $props();

	let selectedIds = $state<string[]>([]);
	let dialogOpen = $state(false);
	let activeAction = $state<'delete' | 'cancel' | 'accept' | 'decline' | null>(null);

	let supportsSelection = $derived(bucket !== 'purged');

	// Reset selection on tab/appointments change
	$effect(() => {
		if (appointments) {
			selectedIds = [];
		}
	});

	function fmt(iso: string): string {
		return new Date(iso).toLocaleString([], {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function handleSelectAll(e: Event) {
		const checkbox = e.target as HTMLInputElement;
		if (checkbox.checked) {
			selectedIds = appointments.map((a) => a.id);
		} else {
			selectedIds = [];
		}
	}

	function handleSelectRow(id: string, checked: boolean) {
		if (checked) {
			if (!selectedIds.includes(id)) {
				selectedIds = [...selectedIds, id];
			}
		} else {
			selectedIds = selectedIds.filter((x) => x !== id);
		}
	}

	function triggerAction(action: 'delete' | 'cancel' | 'accept' | 'decline') {
		activeAction = action;
		dialogOpen = true;
	}
</script>

{#if supportsSelection}
	<AppointmentsBulkActions {bucket} selectedCount={selectedIds.length} onAction={triggerAction} />
{/if}

<div class="list-header">
	<span class="list-header-label">Appointment</span>
	{#if supportsSelection}
		<label class="action-target">
			<input
				type="checkbox"
				class="header-checkbox"
				checked={selectedIds.length === appointments.length && appointments.length > 0}
				onchange={handleSelectAll}
				aria-label="Select all rows"
			/>
		</label>
	{/if}
</div>

<ul class="appointments-list" class:no-selection={!supportsSelection}>
	{#each appointments as a (a.id)}
		<li class="appointment-row" class:past={a.is_past} class:selected={selectedIds.includes(a.id)}>
			<div class="details-guest">
				<div class="guest-info">
					<a href="/appointment/{a.id}" class="row-link">{a.guest_name}</a>
					<span class="guest-email" class:no-email={!a.guest_email}>
						{a.guest_email ?? 'No email'}
					</span>
				</div>
			</div>
			<div class="details-event">
				<span class="event-tag">{a.event_type_name}</span>
			</div>
			<div class="details-time">
				<span class="time-text">{fmt(a.start_time)}</span>
			</div>
			<div class="details-status">
				<div class="status-wrapper">
					<span class="status-badge status-{a.display_status}">
						{#if a.display_status === 'in_progress'}
							in progress
						{:else}
							{a.display_status}
						{/if}
					</span>
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
			</div>
			{#if supportsSelection}
				<label class="action-target">
					<input
						type="checkbox"
						checked={selectedIds.includes(a.id)}
						onchange={(e) => handleSelectRow(a.id, (e.target as HTMLInputElement).checked)}
						aria-label="Select appointment"
					/>
				</label>
			{/if}
		</li>
	{/each}
</ul>

<!-- Must be last in the flow, or the gap lands above the first row instead of below the last. -->
{#if supportsSelection}
	<div
		class="bulk-bar-spacer"
		class:has-selection={selectedIds.length > 0}
		aria-hidden="true"
	></div>
{/if}

{#if dialogOpen && activeAction}
	<AppointmentsBulkDialog bind:open={dialogOpen} action={activeAction} {selectedIds} />
{/if}

<style>
	.list-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		background: var(--when-color-surface-page);
		border-bottom: 1px solid var(--color-border);
		padding: 0 var(--space-5);
	}

	.list-header-label {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: var(--space-4) 0;
	}

	.appointments-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.appointment-row {
		position: relative;
		display: grid;
		grid-template-columns: 2fr 1.2fr 2.2fr 1.5fr 44px;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-md);
		transition: background var(--transition);
	}

	.no-selection .appointment-row {
		grid-template-columns: 2fr 1.2fr 2.2fr 1.5fr;
	}

	.appointment-row:last-child {
		border-bottom: none;
	}

	.appointment-row:hover {
		background: var(--when-color-surface-page);
	}

	.appointment-row.selected {
		background: var(--color-surface-active);
	}

	.details-guest,
	.details-event,
	.details-time,
	.details-status {
		min-width: 0;
	}

	.bulk-bar-spacer {
		height: 0;
	}

	.action-target {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		align-self: stretch;
		min-width: 44px;
		min-height: 44px;
		cursor: pointer;
	}

	.header-checkbox,
	.action-target input[type='checkbox'] {
		width: 18px;
		height: 18px;
		cursor: pointer;
		accent-color: var(--when-color-primary);
	}

	/* rows styling for past events */
	.appointment-row.past {
		color: var(--color-text-muted);
	}

	.appointment-row.past .row-link {
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	.appointment-row.past .event-tag {
		background: var(--color-surface-muted);
		color: var(--color-text-muted);
	}

	/* cell specifics */
	.guest-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.row-link {
		color: var(--when-color-text);
		text-decoration: none;
		font-weight: 600;
		font-size: var(--font-size-lg);
	}

	/* Stretches the guest-name link over the whole row, so the row is clickable without a
	   click handler on the <li>. */
	.row-link::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.guest-email {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.guest-email.no-email {
		font-style: italic;
	}

	.event-tag {
		display: inline-block;
		font-size: var(--font-size-sm);
		font-weight: 600;
		background: var(--color-surface-muted);
		color: var(--color-text-secondary);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.time-text {
		font-weight: 500;
		font-size: var(--font-size-base);
		white-space: nowrap;
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
		background: color-mix(in srgb, var(--color-warning) 12%, transparent);
		color: var(--color-warning);
		white-space: nowrap;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		font-size: var(--font-size-sm);
		font-weight: 600;
		text-transform: capitalize;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.status-confirmed {
		background: var(--color-info-bg);
		color: var(--color-info-strong);
	}

	.status-in_progress {
		background: var(--color-success-bg);
		color: var(--color-success-strong);
	}

	.status-pending {
		background: var(--color-warning-bg);
		color: var(--color-warning-strong);
	}

	.status-concluded,
	.status-rescheduled {
		background: var(--color-quiet-bg);
		color: var(--color-quiet-strong);
	}

	.status-declined,
	.status-cancelled,
	.status-expired {
		background: var(--color-danger-bg);
		color: var(--color-danger-strong);
	}

	@media (prefers-color-scheme: dark) {
		.status-declined,
		.status-cancelled,
		.status-expired {
			color: var(--color-danger);
		}
	}

	/* ---- responsive overrides ---- */
	@media (max-width: 768px) {
		.list-header,
		.appointment-row {
			padding-left: var(--space-4);
			padding-right: var(--space-4);
		}

		.list-header-label {
			padding: var(--space-3) 0;
		}

		.appointment-row {
			grid-template-columns: minmax(0, 1fr) auto 44px;
			gap: var(--space-1) var(--space-3);
			align-items: start;
			padding-top: var(--space-3);
			padding-bottom: var(--space-3);
		}

		.no-selection .appointment-row {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.details-guest {
			grid-column: 1;
			grid-row: 1;
		}

		.details-status {
			grid-column: 2;
			grid-row: 1;
			justify-self: end;
		}

		.details-time {
			grid-column: 1;
			grid-row: 2;
		}

		.details-event {
			grid-column: 2;
			grid-row: 2;
			justify-self: end;
		}

		.action-target {
			grid-column: 3;
			grid-row: 1 / span 2;
		}

		.bulk-bar-spacer.has-selection {
			height: calc(56px + var(--space-4) * 2 + env(safe-area-inset-bottom));
		}
	}
</style>
