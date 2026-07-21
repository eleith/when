<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status} — When</title>
</svelte:head>

<main class="error-page">
	<h1>{page.status}</h1>
	<p>{page.error?.message ?? 'Something went wrong.'}</p>
	<a href="/">Back to home</a>
</main>

<style>
	.error-page {
		max-width: 480px;
		margin: var(--space-10) auto;
		text-align: center;
		color: var(--when-color-text);
	}

	h1 {
		font-size: var(--font-size-display);
		font-weight: 700;
		margin: 0 0 var(--space-3);
	}

	p {
		color: var(--color-text-muted);
		margin: 0 0 var(--space-7);
	}

	a {
		color: var(--when-color-primary);
	}
</style>
