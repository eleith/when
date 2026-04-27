<script lang="ts">
	import '$lib/styles/theme.css';
	import favicon from '$lib/assets/favicon.svg';

	let { data, children } = $props();

	let accent = $derived(data?.branding?.accent_color ?? '#4f46e5');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="app-root" style="--accent: {accent}">
	{@render children()}
</div>

<style>
	.app-root {
		min-height: 100vh;
	}

	:global(a) {
		color: var(--accent, #4f46e5);
	}
</style>
