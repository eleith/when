<script lang="ts">
	import IconWarning from 'virtual:icons/ph/warning';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import type { Snippet } from 'svelte';

	let { href = null, children }: { href?: string | null; children: Snippet } = $props();
</script>

{#if href}
	<a {href} class="alert">
		<IconWarning aria-hidden="true" />
		<span>{@render children()}</span>
		<span class="alert-arrow"><IconArrowRight aria-hidden="true" /></span>
	</a>
{:else}
	<div class="alert" role="alert">
		<IconWarning aria-hidden="true" />
		<span>{@render children()}</span>
	</div>
{/if}

<style>
	.alert {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-warning) 12%, transparent);
		color: var(--color-warning);
		font-size: var(--font-size-sm);
		font-weight: 500;
		text-decoration: none;
	}

	a.alert:hover {
		background: color-mix(in srgb, var(--color-warning) 18%, transparent);
	}

	.alert-arrow {
		margin-left: auto;
		flex-shrink: 0;
		font-size: var(--font-size-base);
	}
</style>
