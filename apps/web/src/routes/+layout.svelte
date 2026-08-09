<script lang="ts">
	import { onMount } from 'svelte';
	import '$lib/styles/reset.css';
	import '$lib/styles/theme.css';
	import '$lib/styles/calendar.css';
	import '$lib/styles/utility.css';
	import '$lib/styles/fonts/outfit.css';
	import '$lib/styles/fonts/inter.css';
	import '$lib/styles/fonts/lato.css';
	import '$lib/styles/fonts/noto-sans.css';
	import { createPreferredTimezone } from '$lib/preferredTimezone.svelte';

	let { data, children } = $props();

	let favicon = $derived(data.appearance.favicon_path);
	let ogImage = $derived(data.ogImage);

	// Seed once; after init the context is the source of truth (cookie is request-stable).
	// svelte-ignore state_referenced_locally
	const tz = createPreferredTimezone(data.preferredTimezone);
	onMount(() => {
		if (tz.current == null) {
			tz.set(Intl.DateTimeFormat().resolvedOptions().timeZone, { persist: true });
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta property="og:type" content="website" />
	<meta property="og:title" content={data.appearance.title} />
	<meta property="og:description" content={data.appearance.description} />
	<meta property="og:image" content={ogImage} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={data.appearance.title} />
	<meta name="twitter:description" content={data.appearance.description} />
	<meta name="twitter:image" content={ogImage} />
</svelte:head>

<div class="app-root">
	{@render children()}
</div>

<style>
	.app-root {
		min-height: 100vh;
	}

	:global(a) {
		color: var(--when-color-primary);
	}
</style>
