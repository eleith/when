<script lang="ts">
	import AdminNav from '$lib/components/AdminNav.svelte';

	let { children } = $props();
</script>

<AdminNav />

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
		color: var(--text);
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
