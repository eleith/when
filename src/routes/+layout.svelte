<script lang="ts">
	import '$lib/styles/reset.css';
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

		/* Derived Brand Palette */
		--accent-secondary: oklch(from var(--accent) l c calc(h + 35));
		--accent-tertiary: oklch(from var(--accent) l c calc(h - 35));

		/* Tonal Scale (Light Mode) */
		--accent-muted: oklch(from var(--accent) 0.97 0.02 h);
		--accent-border: oklch(from var(--accent) 0.92 0.05 h);
		--accent-secondary-muted: oklch(from var(--accent-secondary) 0.97 0.02 h);
		--accent-tertiary-muted: oklch(from var(--accent-tertiary) 0.97 0.02 h);
	}

	@media (prefers-color-scheme: dark) {
		.app-root {
			--accent: var(--accent-dark);

			/* Tonal Scale (Dark Mode) */
			--accent-muted: oklch(from var(--accent) 0.15 0.05 h);
			--accent-border: oklch(from var(--accent) 0.25 0.1 h);
			--accent-secondary-muted: oklch(from var(--accent-secondary) 0.15 0.05 h);
			--accent-tertiary-muted: oklch(from var(--accent-tertiary) 0.15 0.05 h);
		}
	}

	:global(a) {
		color: var(--accent);
	}
</style>
