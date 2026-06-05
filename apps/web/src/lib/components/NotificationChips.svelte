<script lang="ts">
	import type { ChannelNotification } from '$lib/notifications';

	let { notifications }: { notifications: ChannelNotification[] } = $props();
</script>

{#each notifications as n (n.channel)}
	<span class="chip" class:chip-failed={n.state === 'failed'}>
		{#if n.channel === 'email'}Email{:else}Calendar Sync{/if}:
		{#if n.state === 'queued'}Sending…{:else}Failed{/if}
	</span>
{/each}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		font-size: var(--font-size-xs);
		font-weight: 600;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--surface-muted);
		color: var(--text-muted);
		white-space: nowrap;
	}

	.chip-failed {
		background: color-mix(in srgb, var(--warning) 12%, transparent);
		color: var(--warning);
	}
</style>
