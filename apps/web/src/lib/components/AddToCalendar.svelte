<script lang="ts">
	import { Dialog } from 'bits-ui';

	interface Props {
		links: { google: string; outlook: string; ics: string };
		appointmentId: string;
	}

	let { links, appointmentId }: Props = $props();

	let open = $state(false);
</script>

<button type="button" class="atc-cta" onclick={() => (open = true)}> Add to calendar </button>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props })}
				<div {...props} class="atc-overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props })}
				<div {...props} class="atc-dialog">
					<Dialog.Title>
						{#snippet child({ props: titleProps })}
							<h2 {...titleProps} class="atc-dialog-title">Add to calendar</h2>
						{/snippet}
					</Dialog.Title>
					<div class="atc-options">
						<a
							class="atc-option"
							href={links.google}
							target="_blank"
							rel="noopener noreferrer"
							onclick={() => (open = false)}>Google</a
						>
						<a
							class="atc-option"
							href={links.outlook}
							target="_blank"
							rel="noopener noreferrer"
							onclick={() => (open = false)}>Outlook</a
						>
						<a class="atc-option" href={links.ics} onclick={() => (open = false)}>Apple</a>
						<a
							class="atc-option"
							href={links.ics}
							download="when-{appointmentId}.ics"
							onclick={() => (open = false)}>Download .ics</a
						>
					</div>
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.atc-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: var(--space-4) var(--space-6);
		border: none;
		border-radius: var(--radius);
		background: var(--when-color-primary);
		color: var(--when-color-text-on-primary);
		font-size: var(--font-size-md);
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: opacity var(--transition);
	}

	.atc-cta:hover {
		opacity: 0.9;
	}

	.atc-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 200;
		animation: atc-fade-in 0.15s ease-out;
	}

	.atc-dialog {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 201;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-6);
		padding-bottom: calc(var(--space-6) + env(safe-area-inset-bottom));
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
		animation: atc-slide-up 0.2s ease-out;
	}

	@media (min-width: 769px) {
		.atc-dialog {
			top: 50%;
			bottom: auto;
			left: 50%;
			right: auto;
			width: 360px;
			max-width: calc(100vw - var(--space-7) * 2);
			padding-bottom: var(--space-6);
			transform: translate(-50%, -50%);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-md);
			animation: atc-fade-up 0.2s ease-out;
		}
	}

	.atc-dialog-title {
		margin: 0;
		font-size: var(--font-size-lg);
		font-weight: 700;
	}

	.atc-options {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.atc-option {
		display: block;
		padding: var(--space-4);
		border-radius: var(--radius-sm);
		color: var(--when-color-text);
		text-decoration: none;
		font-size: var(--font-size-md);
		font-weight: 500;
	}

	.atc-option:hover,
	.atc-option:focus-visible {
		background: var(--color-surface-muted);
		outline: none;
	}

	@keyframes atc-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes atc-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes atc-fade-up {
		from {
			transform: translate(-50%, calc(-50% + 8px));
			opacity: 0;
		}
		to {
			transform: translate(-50%, -50%);
			opacity: 1;
		}
	}
</style>
