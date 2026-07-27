<script lang="ts">
	import { goto } from '$app/navigation';
	import IconWarning from 'virtual:icons/ph/warning';
	import IconX from 'virtual:icons/ph/x';
	import type { toAppointmentView } from '$lib/server/appointments';
	import AppointmentsBulkActions from '$lib/components/AppointmentsBulkActions.svelte';
	import { Dialog } from 'bits-ui';

	interface Props {
		appointments: ReturnType<typeof toAppointmentView>[];
		bucket?: 'upcoming' | 'pending' | 'concluded' | 'archived' | 'purged';
	}

	let { appointments, bucket = 'upcoming' }: Props = $props();

	let selectedIds = $state<string[]>([]);
	let dialogOpen = $state(false);
	let activeAction = $state<'delete' | 'cancel' | 'accept' | 'decline' | null>(null);
	let cancelReason = $state('I can no longer attend');

	let hasActionColumn = $derived(bucket !== 'purged');

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

	function handleRowClick(e: MouseEvent, id: string) {
		const target = e.target as HTMLElement;
		if (
			target.closest('a') ||
			target.closest('input[type="checkbox"]') ||
			target.closest('button')
		) {
			return;
		}
		goto(`/appointment/${id}`);
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
		if (action === 'cancel') {
			cancelReason = 'I can no longer attend';
		}
		dialogOpen = true;
	}
</script>

<AppointmentsBulkActions {bucket} selectedCount={selectedIds.length} onAction={triggerAction} />

<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th>Appointment</th>
				{#if hasActionColumn}
					<th class="cell-action-header">
						<label class="action-target">
							<input
								type="checkbox"
								class="header-checkbox"
								checked={selectedIds.length === appointments.length && appointments.length > 0}
								onchange={handleSelectAll}
								aria-label="Select all rows"
							/>
						</label>
					</th>
				{/if}
			</tr>
		</thead>
		<tbody>
			{#each appointments as a (a.id)}
				<tr
					class:past={a.is_past}
					class:selected={selectedIds.includes(a.id)}
					onclick={(e) => handleRowClick(e, a.id)}
				>
					<td class="cell-details">
						<div class="details-layout">
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
						</div>
					</td>
					{#if hasActionColumn}
						<td class="cell-action" onclick={(e) => e.stopPropagation()}>
							<label class="action-target">
								<input
									type="checkbox"
									checked={selectedIds.includes(a.id)}
									onchange={(e) => handleSelectRow(a.id, (e.target as HTMLInputElement).checked)}
									aria-label="Select appointment"
								/>
							</label>
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if dialogOpen && activeAction}
	<Dialog.Root bind:open={dialogOpen}>
		<Dialog.Portal>
			<Dialog.Overlay>
				{#snippet child({ props: overlayProps })}
					<div {...overlayProps} class="dialog-overlay"></div>
				{/snippet}
			</Dialog.Overlay>
			<Dialog.Content>
				{#snippet child({ props: dialogProps })}
					<div {...dialogProps} class="dialog-content bulk-actions-dialog">
						<header class="dialog-header">
							<Dialog.Title>
								{#snippet child({ props: titleProps })}
									<h2 {...titleProps} class="dialog-title">
										{#if activeAction === 'delete'}
											Delete {selectedIds.length} Appointment{#if selectedIds.length !== 1}s{/if}?
										{:else if activeAction === 'cancel'}
											Cancel {selectedIds.length} Appointment{#if selectedIds.length !== 1}s{/if}?
										{:else if activeAction === 'accept'}
											Accept {selectedIds.length} Appointment{#if selectedIds.length !== 1}s{/if}?
										{:else if activeAction === 'decline'}
											Decline {selectedIds.length} Appointment{#if selectedIds.length !== 1}s{/if}?
										{/if}
									</h2>
								{/snippet}
							</Dialog.Title>
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<button {...closeProps} class="dialog-close" aria-label="Close">
										<IconX class="icon-close" />
									</button>
								{/snippet}
							</Dialog.Close>
						</header>

						{#if activeAction === 'delete'}
							<p class="dialog-desc">
								Are you sure you want to delete these {selectedIds.length} selected appointments?
								<strong
									>This will delete the entire rescheduling chain for each of these appointments.</strong
								> This action cannot be undone.
							</p>
							<form method="POST" action="/admin/appointments?/bulkDelete" class="dialog-actions">
								{#each selectedIds as id (id)}
									<input type="hidden" name="ids" value={id} />
								{/each}
								<button type="submit" class="btn-confirm btn-confirm-danger">Yes, delete</button>
								<Dialog.Close>
									{#snippet child({ props: closeProps })}
										<button {...closeProps} type="button" class="btn-cancel">Cancel</button>
									{/snippet}
								</Dialog.Close>
							</form>
						{:else if activeAction === 'cancel'}
							<p class="dialog-desc">
								Are you sure you want to cancel these {selectedIds.length} selected appointments?
							</p>
							<form method="POST" action="/admin/appointments?/bulkCancel" class="dialog-form">
								{#each selectedIds as id (id)}
									<input type="hidden" name="ids" value={id} />
								{/each}
								<div class="form-group">
									<label for="cancel-reason" class="form-label">Reason for cancelling</label>
									<textarea
										id="cancel-reason"
										name="reason"
										bind:value={cancelReason}
										class="form-textarea"
										required
									></textarea>
								</div>
								<div class="dialog-actions">
									<button type="submit" class="btn-confirm btn-confirm-danger">Yes, cancel</button>
									<Dialog.Close>
										{#snippet child({ props: closeProps })}
											<button {...closeProps} type="button" class="btn-cancel">Cancel</button>
										{/snippet}
									</Dialog.Close>
								</div>
							</form>
						{:else if activeAction === 'accept'}
							<p class="dialog-desc">
								Are you sure you want to accept these {selectedIds.length} selected pending appointments?
							</p>
							<form method="POST" action="/admin/appointments?/bulkAccept" class="dialog-actions">
								{#each selectedIds as id (id)}
									<input type="hidden" name="ids" value={id} />
								{/each}
								<button type="submit" class="btn-confirm btn-confirm-success">Yes, accept</button>
								<Dialog.Close>
									{#snippet child({ props: closeProps })}
										<button {...closeProps} type="button" class="btn-cancel">Cancel</button>
									{/snippet}
								</Dialog.Close>
							</form>
						{:else if activeAction === 'decline'}
							<p class="dialog-desc">
								Are you sure you want to decline these {selectedIds.length} selected pending appointments?
							</p>
							<form method="POST" action="/admin/appointments?/bulkDecline" class="dialog-actions">
								{#each selectedIds as id (id)}
									<input type="hidden" name="ids" value={id} />
								{/each}
								<button type="submit" class="btn-confirm btn-confirm-danger">Yes, decline</button>
								<Dialog.Close>
									{#snippet child({ props: closeProps })}
										<button {...closeProps} type="button" class="btn-cancel">Cancel</button>
									{/snippet}
								</Dialog.Close>
							</form>
						{/if}
					</div>
				{/snippet}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{/if}

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
	}

	.cell-details {
		width: 100%;
	}

	.details-layout {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		width: 100%;
	}

	.details-guest {
		flex: 2;
		min-width: 0;
	}

	.details-event {
		flex: 1.2;
		min-width: 0;
	}

	.details-time {
		flex: 2.2;
		min-width: 0;
	}

	.details-status {
		flex: 1.5;
		min-width: 0;
		display: flex;
		justify-content: flex-start;
	}

	th {
		background: var(--when-color-surface-page);
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
	}

	td {
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
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
		background: var(--when-color-surface-page);
	}

	/* Row selection styling */
	tr.selected {
		background: var(--color-surface-active);
	}

	/* Checkbox column styling. The padding lives on .action-target, not the cell, so the
	   whole column is tappable rather than just the 18px input. */
	.cell-action-header,
	.cell-action {
		width: 60px;
		padding: 0;
		vertical-align: middle;
	}

	.action-target {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 44px;
		min-height: 44px;
		height: 100%;
		padding: var(--space-4) var(--space-5);
		cursor: pointer;
	}

	.header-checkbox,
	.cell-action input[type='checkbox'] {
		width: 18px;
		height: 18px;
		cursor: pointer;
		accent-color: var(--when-color-primary);
	}

	/* ---- Dialog Overlay & Content ---- */
	.dialog-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 200;
		animation: bulk-fade-in 0.15s ease-out;
	}

	.dialog-content.bulk-actions-dialog {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 201;
		display: flex;
		flex-direction: column;
		max-height: 80vh;
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		padding: var(--space-6);
		gap: var(--space-5);
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
		animation: bulk-slide-up 0.2s ease-out;
	}

	@media (min-width: 769px) {
		.dialog-content.bulk-actions-dialog {
			top: 50%;
			bottom: auto;
			left: 50%;
			right: auto;
			width: 460px;
			max-width: calc(100vw - var(--space-7) * 2);
			transform: translate(-50%, -50%);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-md);
			animation: bulk-fade-up-desktop 0.2s ease-out;
		}
	}

	@keyframes bulk-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes bulk-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes bulk-fade-up-desktop {
		from {
			transform: translate(-50%, calc(-50% + 8px));
			opacity: 0;
		}
		to {
			transform: translate(-50%, -50%);
			opacity: 1;
		}
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.dialog-title {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: 700;
	}

	.dialog-close {
		background: none;
		border: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		transition:
			background var(--transition),
			color var(--transition);
	}

	.dialog-close:hover {
		background: var(--color-surface-muted);
		color: var(--when-color-text);
	}

	.dialog-close :global(svg) {
		width: 20px;
		height: 20px;
	}

	.dialog-desc {
		color: var(--color-text-secondary);
		font-size: var(--font-size-md);
		line-height: 1.5;
		margin: 0;
	}

	.dialog-actions {
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
		margin-top: var(--space-4);
	}

	.dialog-actions.justify-center {
		justify-content: center;
	}

	.dialog-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.form-label {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--when-color-text);
	}

	.form-textarea {
		width: 100%;
		height: 80px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--when-color-text);
		font-size: var(--font-size-base);
		font-family: inherit;
		resize: none;
	}

	.form-textarea:focus {
		outline: none;
		border-color: var(--when-color-primary);
	}

	/* Button variants */
	.btn-confirm {
		height: 40px;
		padding: 0 var(--space-4);
		border: none;
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--transition);
	}

	.btn-confirm:hover {
		opacity: 0.9;
	}

	.btn-confirm-danger {
		background: var(--color-danger);
		color: var(--when-color-text-on-primary);
	}

	.btn-confirm-success {
		background: var(--color-success);
		color: var(--when-color-text-on-primary);
	}

	.btn-cancel {
		height: 40px;
		padding: 0 var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--when-color-text);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition: background var(--transition);
	}

	.btn-cancel:hover {
		background: var(--color-surface-muted);
	}

	/* rows styling for past events */
	tr.past td {
		color: var(--color-text-muted);
	}

	tr.past .row-link {
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	tr.past .event-tag {
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
		th,
		td {
			padding: var(--space-3) var(--space-4);
		}

		.cell-action-header,
		.cell-action {
			padding: 0;
		}

		.action-target {
			padding: var(--space-3) var(--space-4);
		}

		.details-layout {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-2) var(--space-4);
			align-items: start;
		}

		.details-guest {
			grid-column: 1;
			grid-row: 1 / span 3;
		}

		.details-event {
			grid-column: 2;
			grid-row: 2;
			display: flex;
			justify-content: flex-end;
		}

		.details-time {
			grid-column: 2;
			grid-row: 1;
			text-align: right;
		}

		.details-status {
			grid-column: 2;
			grid-row: 3;
			display: flex;
			justify-content: flex-end;
		}
	}
</style>
