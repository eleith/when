<script lang="ts">
	import '$lib/styles/reset.css';
	import '$lib/styles/theme.css';
	import defaultFavicon from '$lib/assets/favicon.svg';

	let { data, children } = $props();

	let primary = $derived(data?.branding?.primary ?? { light: '#4f46e5', dark: '#4f46e5' });
	let favicon = $derived(data?.branding?.favicon_url ?? defaultFavicon);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-root" style="--primary-light: {primary.light}; --primary-dark: {primary.dark};">
	{@render children()}
</div>

<style>
	.app-root {
		min-height: 100vh;
		--primary: var(--primary-light);

		/* Tonal Scale (Light Mode) */
		--primary-muted: oklch(from var(--primary) 0.97 0.02 h);
		--primary-border: oklch(from var(--primary) 0.92 0.05 h);
	}

	@media (prefers-color-scheme: dark) {
		.app-root {
			--primary: var(--primary-dark);

			/* Tonal Scale (Dark Mode) */
			--primary-muted: oklch(from var(--primary) 0.15 0.05 h);
			--primary-border: oklch(from var(--primary) 0.25 0.1 h);
		}
	}

	:global(a) {
		color: var(--primary);
	}
</style>
