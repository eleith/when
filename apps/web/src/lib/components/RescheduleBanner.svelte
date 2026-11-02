<script lang="ts">
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import * as InstantFns from 'temporal-polyfill/fns/Instant';
	import { formatDateCompact, formatTimeRangeShort, instantToDateKey } from '#lib/datetime.js';
	import type { AppointmentFlow } from '#lib/appointmentFlow.svelte.js';

	interface Props {
		previousHref: string;
		startTime: string;
		endTime: string;
		flow: AppointmentFlow;
	}

	let { previousHref, startTime, endTime, flow }: Props = $props();
	const originalDate = $derived(instantToDateKey(startTime, flow.userTz));
	const proposedEnd = $derived.by(() => {
		if (!flow.selectedSlot) return null;
		const start = InstantFns.fromString(flow.selectedSlot);
		return InstantFns.toString(InstantFns.addMinutes(start, flow.duration));
	});
</script>

<aside class="banner" aria-label="Reschedule summary">
	<a class="return-link" href={previousHref}>
		<span class="return-label">
			<IconCaretLeft aria-hidden="true" />
			<span>Back to appointment</span>
		</span>
	</a>
	<dl class="summary">
		<div>
			<dt>Original</dt>
			<dd>
				<span>{formatDateCompact(originalDate)}</span>
				<span>{formatTimeRangeShort(startTime, endTime, flow.userTz)}</span>
			</dd>
		</div>
		<div>
			<dt>Proposed</dt>
			<dd>
				{#if flow.hasChanges}
					<span>{flow.viewDate ? formatDateCompact(flow.viewDate) : '—'}</span>
					<span>
						{flow.selectedSlot && proposedEnd
							? formatTimeRangeShort(flow.selectedSlot, proposedEnd, flow.userTz)
							: '—'}
					</span>
				{:else}
					—
				{/if}
			</dd>
		</div>
	</dl>
</aside>

<style>
	.banner {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		align-items: stretch;
		gap: var(--space-5);
		padding: var(--space-5) var(--space-6);
		margin-bottom: var(--space-6);
		background: var(--color-info-bg);
		border: 1px solid var(--color-info-border);
		border-radius: var(--radius-md);
	}

	.summary {
		display: grid;
		grid-column: span 2;
		grid-template-columns: subgrid;
		gap: var(--space-5);
		margin: 0;
		color: var(--when-color-text);
	}

	.summary > div + div {
		border-left: 1px solid var(--color-info-border);
		padding-left: var(--space-5);
	}

	dt {
		font-weight: 600;
		font-size: var(--font-size-sm);
	}

	dd {
		display: flex;
		flex-direction: column;
		margin: 0;
	}

	.return-link {
		display: grid;
		place-items: center;
		min-height: calc(var(--space-8) + var(--space-4));
		padding: var(--space-3) var(--space-4);
		border-right: 1px solid var(--color-info-border);
		color: var(--color-info-strong);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.return-label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		line-height: 1;
	}

	.return-link:hover {
		text-decoration: none;
	}

	.return-link:focus-visible {
		outline: 2px solid var(--color-info-strong);
		outline-offset: 2px;
	}

	@media (max-width: 768px) {
		.banner {
			grid-template-columns: minmax(0, 1fr);
			padding-top: 0;
			border-inline: 0;
			border-radius: 0;
			margin-bottom: 0;
		}

		.summary {
			grid-column: auto;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.return-link {
			padding-block: var(--space-5);
			border-right: 0;
			border-bottom: 1px solid var(--color-info-border);
		}
	}
</style>
