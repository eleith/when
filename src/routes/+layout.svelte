<script lang="ts">
	import '$lib/styles/theme.css';
	import defaultFavicon from '$lib/assets/favicon.svg';

	let { data, children } = $props();

	let accent = $derived(data?.branding?.accent ?? { light: '#4f46e5', dark: '#4f46e5' });
	let favicon = $derived(data?.branding?.favicon_url ?? defaultFavicon);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-root" style="--accent-light: {accent.light}; --accent-dark: {accent.dark};">
	{@render children()}
</div>

<style>
	.app-root {
		min-height: 100vh;
		--accent: var(--accent-light);
	}

	@media (prefers-color-scheme: dark) {
		.app-root {
			--accent: var(--accent-dark);
		}
	}

	:global(a) {
		color: var(--accent);
	}
</style>
