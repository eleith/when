<script lang="ts">
	import { onMount } from 'svelte';
	import IconMoon from 'virtual:icons/ph/moon';
	import IconSunDim from 'virtual:icons/ph/sun-dim';
	import IconFaders from 'virtual:icons/ph/faders';

	type Preference = 'system' | 'dark' | 'light';
	let preference = $state<Preference>('system');
	let ready = $state(false);

	onMount(() => {
		const saved = document.documentElement.dataset.theme;
		if (saved === 'dark' || saved === 'light' || saved === 'system') preference = saved;
		ready = true;
	});

	function cycleTheme() {
		if (preference === 'system') preference = 'dark';
		else if (preference === 'dark') preference = 'light';
		else preference = 'system';

		document.documentElement.dataset.theme = preference;
		try {
			window.localStorage.setItem('when.theme', preference);
		} catch {
			// The choice still works for this visit when storage is unavailable.
		}
	}
</script>

<button type="button" disabled={!ready} onclick={cycleTheme}>
	{#if preference === 'system'}
		<span class="visibility-hidden">Switch to dark theme</span>
		<IconMoon aria-hidden="true" />
	{:else if preference === 'dark'}
		<span class="visibility-hidden">Switch to light theme</span>
		<IconSunDim aria-hidden="true" />
	{:else}
		<span class="visibility-hidden">Use system theme</span>
		<IconFaders aria-hidden="true" />
	{/if}
</button>

<style>
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: calc(var(--space-8) + var(--space-4));
		min-height: calc(var(--space-8) + var(--space-4));
		padding: var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text-secondary);
		font-size: var(--font-size-xl);
		cursor: pointer;
	}

	button:hover {
		background: var(--color-surface-active);
		color: var(--when-color-text);
	}

	button:focus-visible {
		outline: var(--space-1) solid var(--when-color-primary);
		outline-offset: var(--space-1);
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
