<script lang="ts">
	import { onMount } from 'svelte';
	import '$lib/styles/reset.css';
	import '$lib/styles/theme.css';
	import '$lib/styles/calendar.css';
	import '$lib/styles/utility.css';
	import '$lib/styles/fonts/outfit.css';
	import '$lib/styles/fonts/inter.css';
	import '$lib/styles/fonts/lato.css';
	import defaultFavicon from '$lib/assets/favicon.svg';
	import { createPreferredTimezone } from '$lib/preferredTimezone.svelte';

	let { data, children } = $props();

	let favicon = $derived(data?.appearance?.favicon_url ?? defaultFavicon);

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
</svelte:head>

<div class="app-root">
	{@render children()}
</div>

<style>
	.app-root {
		min-height: 100vh;
	}

	:global(a) {
		color: var(--primary);
	}
</style>
