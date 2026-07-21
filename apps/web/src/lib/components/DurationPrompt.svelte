<!-- Step 2 prompt: "Let's meet for N minutes", opening the duration picker when there's a choice. -->
<script lang="ts">
	import DurationDialog from '$lib/components/DurationDialog.svelte';

	interface Props {
		durations: number[];
		value: number;
	}

	let { durations, value = $bindable() }: Props = $props();

	let open = $state(false);
</script>

{#if durations.length > 1}
	<p class="prompt">
		Let's meet for
		<button type="button" class="pick" onclick={() => (open = true)}>
			{value} minutes
		</button>
	</p>

	<DurationDialog bind:open {durations} bind:value />
{/if}

<style>
	/* A quiet prompt between the day/timezone header and the time slots. */
	.prompt {
		margin: var(--space-4) 0;
		padding: var(--space-5) 0;
		border-top: 1px solid var(--border);
		text-align: center;
		font-size: var(--font-size-lg);
		color: var(--text-secondary);
	}

	.pick {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-weight: 600;
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.pick:hover {
		text-decoration-thickness: 2px;
	}
</style>
