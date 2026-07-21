<script lang="ts">
	import { Dialog } from 'bits-ui';

	interface Props {
		open?: boolean;
		durations: number[];
		value?: number;
		onSelect: (minutes: number) => void;
	}

	let { open = $bindable(false), durations, value, onSelect }: Props = $props();

	function select(d: number) {
		onSelect(d);
		open = false;
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
				<div {...props} class="dialog-content duration-dialog">
					<header class="duration-dialog-header">
						<Dialog.Title>
							{#snippet child({ props: titleProps })}
								<h2 {...titleProps} class="duration-dialog-title">How long?</h2>
							{/snippet}
						</Dialog.Title>
						<Dialog.Close>
							{#snippet child({ props: closeProps })}
								<button {...closeProps} class="duration-dialog-close" aria-label="Close">
									&times;
								</button>
							{/snippet}
						</Dialog.Close>
					</header>
					<ul class="duration-list">
						{#each durations as d (d)}
							<li>
								<button
									type="button"
									class="duration-row"
									class:selected={d === value}
									onclick={() => select(d)}
								>
									{d} minutes
								</button>
							</li>
						{/each}
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
		animation: duration-fade-in 0.15s ease-out;
	}

	.dialog-content.duration-dialog {
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
		animation: duration-slide-up 0.2s ease-out;
	}

	@media (min-width: 769px) {
		.dialog-content.duration-dialog {
			top: 50%;
			bottom: auto;
			left: 50%;
			right: auto;
			width: 320px;
			max-width: calc(100vw - var(--space-7) * 2);
			transform: translate(-50%, -50%);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-md);
			animation: none;
		}
	}

	@keyframes duration-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes duration-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	.duration-dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.duration-dialog-title {
		margin: 0;
		font-size: var(--font-size-lg);
		font-weight: 600;
	}

	.duration-dialog-close {
		background: none;
		border: none;
		font-size: var(--font-size-2xl);
		line-height: 1;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.duration-dialog-close:hover {
		background: var(--color-surface-muted);
		color: var(--when-color-text);
	}

	.duration-list {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.duration-row {
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		padding: var(--space-3) var(--space-4);
		font: inherit;
		font-weight: 600;
		color: inherit;
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.duration-row:hover {
		background: var(--color-surface-muted);
	}

	.duration-row.selected {
		background: var(--color-primary-muted);
		color: var(--when-color-primary);
	}
</style>
