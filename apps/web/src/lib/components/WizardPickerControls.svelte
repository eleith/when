<script lang="ts">
	import IconCaretDown from 'virtual:icons/ph/caret-down';
	import { formatTzShort } from '#lib/datetime.js';
	import type { AppointmentFlow } from '#lib/appointmentFlow.svelte.js';
	import DurationDialog from './DurationDialog.svelte';
	import TimezoneDialog from './TimezoneDialog.svelte';

	interface Props {
		flow: AppointmentFlow;
		timezoneReady: boolean;
	}

	let { flow, timezoneReady }: Props = $props();
	let durationOpen = $state(false);
	let tzOpen = $state(false);
	let timezoneLabel = $derived(formatTzShort(flow.userTz));
</script>

<div class="picker-controls" role="group" aria-label="Booking settings">
	{#if flow.durations.length > 1}
		<button
			type="button"
			onclick={() => (durationOpen = true)}
			aria-label="Change duration, currently {flow.duration} minutes"
			aria-haspopup="dialog"
		>
			{flow.duration} min <IconCaretDown aria-hidden="true" />
		</button>
	{:else}
		<span class="fixed-duration">{flow.duration} min</span>
	{/if}

	{#if timezoneReady}
		<button
			type="button"
			class="timezone"
			onclick={() => (tzOpen = true)}
			aria-label="Change timezone, currently {timezoneLabel}"
			aria-haspopup="dialog"
		>
			{timezoneLabel}
			<IconCaretDown aria-hidden="true" />
		</button>
	{:else}
		<span class="timezone-placeholder" aria-hidden="true"></span>
	{/if}
</div>

<DurationDialog
	bind:open={durationOpen}
	durations={flow.durations}
	value={flow.duration}
	onSelect={flow.setDuration}
/>
<TimezoneDialog bind:open={tzOpen} />

<style>
	.picker-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-5);
		border-bottom: calc(var(--space-1) / 2) solid var(--color-border);
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
	}

	button,
	.fixed-duration {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-height: calc(var(--space-8) + var(--space-4));
		padding: 0 var(--space-3);
	}

	button {
		background: transparent;
		border: none;
		border-radius: var(--radius);
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	button:hover {
		background: var(--color-surface-active);
		color: var(--when-color-text);
	}

	button:focus-visible {
		outline: none;
		box-shadow: var(--shadow-focus);
	}

	.timezone,
	.timezone-placeholder {
		margin-left: auto;
	}

	.timezone-placeholder {
		width: var(--space-10);
		height: var(--space-6);
		border-radius: var(--radius);
		background: var(--color-quiet-bg);
	}
</style>
