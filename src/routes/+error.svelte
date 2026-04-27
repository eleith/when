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
		margin: 80px auto;
		text-align: center;
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
		color: var(--text);
	}

	h1 {
		font-size: 3rem;
		font-weight: 700;
		margin: 0 0 8px;
	}

	p {
		color: var(--text-muted);
		margin: 0 0 24px;
	}

	a {
		color: var(--accent, #4f46e5);
	}
</style>
