<script lang="ts">
	import type { Snippet } from 'svelte';
	import AdminNav from '$lib/components/AdminNav.svelte';

	// Owns both the full-bleed nav and the centered content column. Pages render this
	// rather than a layout so each route can name its own crumb.
	let { crumb = null, children }: { crumb?: Snippet | null; children: Snippet } = $props();
</script>

<AdminNav {crumb} />

<div class="admin-container">
	<main class="admin-main">
		{@render children()}
	</main>
</div>

<style>
	.admin-container {
		max-width: 1024px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-6) var(--space-10);
		color: var(--when-color-text);
	}

	.admin-main {
		display: flex;
		flex-direction: column;
	}

	@media (max-width: 768px) {
		.admin-container {
			padding: var(--space-4) var(--space-4) var(--space-8);
		}
	}
</style>
