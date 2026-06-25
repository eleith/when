<script lang="ts">
	import type { ActionLogEntry } from '@when/db';
	import IconLog from 'virtual:icons/ph/log';
	import IconCaretDown from 'virtual:icons/ph/caret-down';
	import IconCalendarPlus from 'virtual:icons/ph/calendar-plus';
	import IconCheckCircle from 'virtual:icons/ph/check-circle';
	import IconXCircle from 'virtual:icons/ph/x-circle';
	import IconCalendarX from 'virtual:icons/ph/calendar-x';
	import IconArrowsClockwise from 'virtual:icons/ph/arrows-clockwise';
	import IconHourglass from 'virtual:icons/ph/hourglass';
	import IconEnvelope from 'virtual:icons/ph/envelope-simple';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconPencilSimple from 'virtual:icons/ph/pencil-simple';
	import IconDot from 'virtual:icons/ph/dot-outline';
	import { formatTimestamp } from '$lib/datetime';

	let {
		log,
		displayTz
	}: {
		log: ActionLogEntry[];
		displayTz: string;
	} = $props();

	// Newest first: the most recent activity is the most relevant to the admin.
	let entries = $derived([...log].reverse());
</script>

<details class="log-section">
	<summary class="log-summary">
		<span class="log-summary-icon"><IconLog aria-hidden="true" /></span>
		<span class="log-summary-text">
			<span class="log-summary-title">Activity log</span>
			<span class="log-summary-count">
				{entries.length}
				{entries.length === 1 ? 'entry' : 'entries'}
			</span>
		</span>
		<span class="log-summary-chevron"><IconCaretDown aria-hidden="true" /></span>
	</summary>

	<div class="log-body">
		{#if entries.length === 0}
			<p class="log-empty">No activity recorded yet.</p>
		{:else}
			<ol class="log-list">
				{#each entries as entry, i (i)}
					{@const state = entry.payload?.metadata?.state}
					<li class="log-item">
						<span class="log-icon" class:is-fail={state === 'failed'}>
							{#if entry.action === 'create'}
								<IconCalendarPlus aria-hidden="true" />
							{:else if entry.action === 'confirm'}
								<IconCheckCircle aria-hidden="true" />
							{:else if entry.action === 'decline'}
								<IconXCircle aria-hidden="true" />
							{:else if entry.action === 'cancel'}
								<IconCalendarX aria-hidden="true" />
							{:else if entry.action === 'reschedule'}
								<IconArrowsClockwise aria-hidden="true" />
							{:else if entry.action === 'expire'}
								<IconHourglass aria-hidden="true" />
							{:else if entry.action === 'email'}
								<IconEnvelope aria-hidden="true" />
							{:else if entry.action === 'calendar'}
								<IconCalendarBlank aria-hidden="true" />
							{:else if entry.action === 'edit'}
								<IconPencilSimple aria-hidden="true" />
							{:else}
								<IconDot aria-hidden="true" />
							{/if}
						</span>
						<div class="log-text">
							<div class="log-primary">
								{#if entry.action === 'create'}
									Created
								{:else if entry.action === 'confirm'}
									Confirmed
								{:else if entry.action === 'decline'}
									Declined
								{:else if entry.action === 'cancel'}
									Cancelled
								{:else if entry.action === 'reschedule'}
									Rescheduled
								{:else if entry.action === 'expire'}
									Expired
								{:else if entry.action === 'email'}
									{#if state === 'done'}
										Email sent
									{:else if state === 'failed'}
										Email failed
									{:else}
										Email queued
									{/if}
								{:else if entry.action === 'calendar'}
									{#if state === 'done'}
										Calendar synced
									{:else if state === 'failed'}
										Calendar sync failed
									{:else}
										Calendar sync queued
									{/if}
								{:else if entry.action === 'edit'}
									{@const changes = (entry.payload?.metadata?.changes as string[]) || []}
									{#if changes.includes('note_added')}
										Note added
									{:else if changes.includes('note_updated')}
										Note updated
									{:else if changes.includes('note_removed')}
										Note removed
									{:else}
										Details updated
									{/if}
								{:else}
									{entry.action}
								{/if}
								{#if entry.action === 'calendar' && entry.payload?.metadata?.op}
									<span class="log-tag">{entry.payload.metadata.op}</span>
								{/if}
							</div>
							<div class="log-secondary">
								{#if entry.actor === 'guest'}
									Guest
								{:else if entry.actor === 'host'}
									Host
								{:else}
									System
								{/if}
								&middot; {formatTimestamp(entry.at, displayTz)}
							</div>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</details>

<style>
	/* Sits as the last section of the appointment card; provides its own top divider. */
	.log-section {
		border-top: 1px solid var(--border);
	}

	.log-summary {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-6) var(--space-7);
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		list-style: none;
		user-select: none;
	}

	.log-summary::-webkit-details-marker {
		display: none;
	}

	.log-summary:hover {
		background: var(--surface-muted);
	}

	.log-summary-icon {
		font-size: var(--font-size-xl);
		color: var(--text-muted);
		display: inline-flex;
		flex-shrink: 0;
		margin-top: 1px;
	}

	.log-summary-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.log-summary-title {
		font-weight: 500;
		font-size: var(--font-size-lg);
		line-height: 1.4;
		color: var(--text);
	}

	.log-summary-count {
		color: var(--text-muted);
		font-size: var(--font-size-base);
		margin-top: 2px;
	}

	.log-summary-chevron {
		margin-left: auto;
		align-self: center;
		display: inline-flex;
		color: var(--text-muted);
		transition: transform var(--transition);
	}

	.log-section[open] .log-summary-chevron {
		transform: rotate(180deg);
	}

	.log-body {
		padding: var(--space-5) var(--space-7) var(--space-6);
		border-bottom: 1px solid var(--border);
	}

	.log-empty {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-base);
	}

	/* Indented with a guide rail so entries read as nested under the summary. */
	.log-list {
		list-style: none;
		margin: 0 0 0 var(--space-4);
		padding: var(--space-1) 0 var(--space-1) var(--space-6);
		border-left: 2px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.log-item {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
	}

	.log-icon {
		font-size: var(--font-size-xl);
		color: var(--text-muted);
		flex-shrink: 0;
		margin-top: 1px;
		display: inline-flex;
	}

	.log-icon.is-fail {
		color: var(--danger-strong);
	}

	.log-text {
		min-width: 0;
	}

	.log-primary {
		color: var(--text);
		font-weight: 500;
		font-size: var(--font-size-lg);
		line-height: 1.4;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.log-tag {
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		background: var(--surface-muted);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 1px var(--space-2);
	}

	.log-secondary {
		color: var(--text-muted);
		font-size: var(--font-size-base);
		margin-top: 2px;
	}

	@media (max-width: 768px) {
		.log-summary {
			padding: var(--space-5) var(--space-5);
		}

		.log-body {
			padding: 0 var(--space-5) var(--space-5);
		}
	}
</style>
