<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Dialog } from 'bits-ui';
	import { tzCity, tzOffset } from '$lib/datetime';
	import { getPreferredTimezone } from '$lib/preferredTimezone.svelte';

	interface Props {
		open?: boolean;
	}

	let { open = $bindable(false) }: Props = $props();

	const ptz = getPreferredTimezone();

	const ALL_TIMEZONES = Intl.supportedValuesOf('timeZone');

	type TzInfo = { city: string; offset: string; haystack: string };
	const TZ_INFO = new SvelteMap<string, TzInfo>();
	for (const tz of ALL_TIMEZONES) {
		const city = tzCity(tz);
		const offset = tzOffset(tz);
		const haystack = `${tz} ${city} ${offset}`.toLowerCase();
		TZ_INFO.set(tz, { city, offset, haystack });
	}

	let search = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);
	let listEl = $state<HTMLUListElement | null>(null);

	let filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		if (!q) return ALL_TIMEZONES;
		return ALL_TIMEZONES.filter((tz) => TZ_INFO.get(tz)?.haystack.includes(q));
	});

	$effect(() => {
		if (!open) return;
		tick().then(() => {
			searchInput?.focus();
			const selected = listEl?.querySelector('.tz-option.selected');
			(selected as HTMLElement | null)?.scrollIntoView({ block: 'center' });
		});
	});

	function select(tz: string) {
		ptz.set(tz, { persist: true });
		open = false;
		search = '';
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="dialog-overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class="dialog-content tz-dialog">
					<header class="tz-dialog-header">
						<Dialog.Title>
							{#snippet child({ props: titleProps })}
								<h2 {...titleProps} class="tz-dialog-title">Choose timezone</h2>
							{/snippet}
						</Dialog.Title>
						<Dialog.Close>
							{#snippet child({ props: closeProps })}
								<button {...closeProps} class="tz-dialog-close" aria-label="Close">&times;</button>
							{/snippet}
						</Dialog.Close>
					</header>
					<input
						class="tz-search"
						type="search"
						placeholder="Search timezone or city…"
						bind:value={search}
						bind:this={searchInput}
						autocomplete="off"
					/>
					<ul class="tz-list" bind:this={listEl}>
						{#each filtered as tz (tz)}
							{@const info = TZ_INFO.get(tz)}
							<li>
								<button
									type="button"
									class="tz-option"
									class:selected={tz === ptz.current}
									onclick={() => select(tz)}
								>
									<span class="tz-option-city">{info?.city ?? tz}</span>
									{#if info?.offset}
										<span class="tz-option-offset">{info.offset}</span>
									{/if}
								</button>
							</li>
						{/each}
						{#if filtered.length === 0}
							<li class="tz-empty">No matches</li>
						{/if}
					</ul>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.dialog-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		z-index: 200;
		animation: tz-fade-in 0.15s ease-out;
	}

	.dialog-content.tz-dialog {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 201;
		display: flex;
		flex-direction: column;
		max-height: 80vh;
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		padding: var(--space-5);
		gap: var(--space-4);
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
		animation: tz-slide-up 0.2s ease-out;
	}

	@media (min-width: 769px) {
		.dialog-content.tz-dialog {
			top: 50%;
			bottom: auto;
			left: 50%;
			right: auto;
			width: 400px;
			max-width: calc(100vw - var(--space-7) * 2);
			max-height: min(70vh, 520px);
			transform: translate(-50%, -50%);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-md);
			animation: tz-fade-up-desktop 0.2s ease-out;
		}
	}

	@keyframes tz-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes tz-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes tz-fade-up-desktop {
		from {
			transform: translate(-50%, calc(-50% + 8px));
			opacity: 0;
		}
		to {
			transform: translate(-50%, -50%);
			opacity: 1;
		}
	}

	.tz-dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.tz-dialog-title {
		margin: 0;
		font-size: var(--font-size-lg);
		font-weight: 600;
	}

	.tz-dialog-close {
		background: none;
		border: none;
		font-size: var(--font-size-2xl);
		line-height: 1;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.tz-dialog-close:hover {
		background: var(--color-surface-muted);
		color: var(--when-color-text);
	}

	.tz-search {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		background: var(--color-surface);
		color: var(--when-color-text);
		box-sizing: border-box;
	}

	.tz-search:focus {
		outline: none;
		border-color: var(--when-color-primary);
		box-shadow: var(--shadow-focus);
	}

	.tz-list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tz-option {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: var(--space-3) var(--space-4);
		font: inherit;
		color: inherit;
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.tz-option:hover {
		background: var(--color-surface-muted);
	}

	.tz-option.selected {
		background: var(--color-primary-muted);
		color: var(--when-color-primary);
		font-weight: 600;
	}

	.tz-option-city {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tz-option-offset {
		flex-shrink: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.tz-option.selected .tz-option-offset {
		color: var(--when-color-primary);
	}

	.tz-empty {
		padding: var(--space-5);
		text-align: center;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}
</style>
