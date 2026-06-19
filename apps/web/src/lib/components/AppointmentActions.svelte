<script lang="ts">
	import { DropdownMenu, Dialog } from 'bits-ui';
	import IconDotsThreeVertical from 'virtual:icons/ph/dots-three-vertical';
	import IconX from 'virtual:icons/ph/x';

	type Gate = { allowed: boolean };

	interface Props {
		actions: { reschedule: Gate; cancel: Gate };
		appointmentId: string;
		token: string;
		onCancel: () => void;
		isAdmin?: boolean;
		onDelete?: () => void;
	}

	let { actions, appointmentId, token, onCancel, isAdmin = false, onDelete }: Props = $props();

	let menuOpen = $state(false);
	let shareDialogOpen = $state(false);

	let rescheduleHref = $derived(
		`/appointment/${appointmentId}/reschedule?token=${encodeURIComponent(token)}`
	);

	let shareLink = $derived.by(() => {
		if (typeof window === 'undefined') return '';
		return `${window.location.origin}/appointment/${appointmentId}?token=${encodeURIComponent(token)}`;
	});

	let copied = $state(false);
	let feedbackTimeout: ReturnType<typeof setTimeout>;
	let copyBtnEl = $state<HTMLButtonElement | null>(null);

	async function handleCopy() {
		try {
			if (navigator.clipboard) {
				await navigator.clipboard.writeText(shareLink);
				copied = true;
			}
		} catch {
			// fallback
		}
		clearTimeout(feedbackTimeout);
		feedbackTimeout = setTimeout(() => {
			copied = false;
		}, 2000);
	}

	$effect(() => {
		if (shareDialogOpen && copyBtnEl) {
			const timer = setTimeout(() => {
				copyBtnEl?.focus();
			}, 50);
			return () => clearTimeout(timer);
		}
	});

	function requestCancel() {
		menuOpen = false;
		onCancel();
	}

	function requestDelete() {
		menuOpen = false;
		onDelete?.();
	}
</script>

<DropdownMenu.Root bind:open={menuOpen}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				class="change-trigger {props.class || ''}"
				aria-label="Appointment actions"
			>
				<IconDotsThreeVertical aria-hidden="true" />
			</button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content align="end" sideOffset={6} forceMount>
			{#snippet child({ wrapperProps, props, open })}
				{#if open}
					<div {...wrapperProps}>
						<div {...props} class="ba-menu">
							{#if actions.reschedule.allowed}
								<DropdownMenu.Item>
									{#snippet child({ props: itemProps })}
										<a {...itemProps} href={rescheduleHref} class="action-item">Reschedule</a>
									{/snippet}
								</DropdownMenu.Item>
							{/if}
							{#if actions.cancel.allowed}
								<DropdownMenu.Item onSelect={requestCancel}>
									{#snippet child({ props: itemProps })}
										<button {...itemProps} type="button" class="action-item action-item-danger"
											>Cancel</button
										>
									{/snippet}
								</DropdownMenu.Item>
							{/if}
							{#if isAdmin}
								<DropdownMenu.Item onSelect={() => (shareDialogOpen = true)}>
									{#snippet child({ props: itemProps })}
										<button {...itemProps} type="button" class="action-item"
											>Copy Attendee Link</button
										>
									{/snippet}
								</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={requestDelete}>
									{#snippet child({ props: itemProps })}
										<button {...itemProps} type="button" class="action-item action-item-danger"
											>Delete</button
										>
									{/snippet}
								</DropdownMenu.Item>
							{/if}
						</div>
					</div>
				{/if}
			{/snippet}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>

{#if isAdmin}
	<Dialog.Root bind:open={shareDialogOpen}>
		<Dialog.Portal>
			<Dialog.Overlay>
				{#snippet child({ props: overlayProps })}
					<div {...overlayProps} class="dialog-overlay"></div>
				{/snippet}
			</Dialog.Overlay>
			<Dialog.Content>
				{#snippet child({ props: dialogProps })}
					<div {...dialogProps} class="dialog-content share-dialog">
						<header class="share-dialog-header">
							<Dialog.Title>
								{#snippet child({ props: titleProps })}
									<h2 {...titleProps} class="share-dialog-title">Copy Attendee Link</h2>
								{/snippet}
							</Dialog.Title>
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<button {...closeProps} class="share-dialog-close" aria-label="Close">
										<IconX class="icon-close" />
									</button>
								{/snippet}
							</Dialog.Close>
						</header>

						<p class="share-dialog-desc">
							Share this link with the attendee to let them view, cancel, or reschedule the
							appointment.
						</p>

						<div class="share-input-wrapper">
							<input
								type="text"
								readonly
								value={shareLink}
								class="share-input"
								onclick={(e) => (e.target as HTMLInputElement).select()}
							/>
							<button
								type="button"
								onclick={handleCopy}
								class="share-copy-btn"
								bind:this={copyBtnEl}
							>
								{copied ? 'Copied' : 'Copy'}
							</button>
						</div>
					</div>
				{/snippet}
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
{/if}

<style>
	.change-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text-secondary);
		cursor: pointer;
		font-size: var(--font-size-xl);
		transition:
			background var(--transition),
			color var(--transition);
	}

	.change-trigger:hover {
		background: var(--surface-active);
		color: var(--text);
	}

	.action-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: var(--space-3) var(--space-4);
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--text);
		font-size: var(--font-size-md);
		font-weight: 500;
		font-family: inherit;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}

	.action-item:hover,
	.action-item:focus-visible {
		background: var(--surface-muted);
		outline: none;
	}

	.action-item-danger {
		color: var(--danger);
	}

	.action-item-danger:hover,
	.action-item-danger:focus-visible {
		background: var(--danger-bg);
		color: var(--danger-strong);
	}

	.ba-menu {
		min-width: 200px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		z-index: 100;
	}

	/* ---- Dialog Overlay & Content ---- */
	.dialog-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 200;
		animation: share-fade-in 0.15s ease-out;
	}

	.dialog-content.share-dialog {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 201;
		display: flex;
		flex-direction: column;
		max-height: 80vh;
		background: var(--surface);
		border-top: 1px solid var(--border);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		padding: var(--space-6);
		gap: var(--space-5);
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
		animation: share-slide-up 0.2s ease-out;
	}

	@media (min-width: 769px) {
		.dialog-content.share-dialog {
			top: 50%;
			bottom: auto;
			left: 50%;
			right: auto;
			width: 440px;
			max-width: calc(100vw - var(--space-7) * 2);
			transform: translate(-50%, -50%);
			border: 1px solid var(--border);
			border-radius: var(--radius-md);
			animation: share-fade-up-desktop 0.2s ease-out;
		}
	}

	@keyframes share-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes share-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes share-fade-up-desktop {
		from {
			transform: translate(-50%, calc(-50% + 8px));
			opacity: 0;
		}
		to {
			transform: translate(-50%, -50%);
			opacity: 1;
		}
	}

	.share-dialog-title {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: 700;
	}

	.share-dialog-desc {
		color: var(--text-secondary);
		font-size: var(--font-size-md);
		line-height: 1.5;
		margin: 0;
	}

	/* ---- Share Input Wrapper ---- */
	.share-input-wrapper {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.share-input {
		flex: 1;
		min-width: 0;
		height: 40px;
		padding: 0 var(--space-3);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--surface-muted);
		color: var(--text);
		font-size: var(--font-size-base);
		font-family: inherit;
	}

	.share-input:focus {
		outline: none;
		border-color: var(--primary);
	}

	.share-copy-btn {
		width: 80px;
		height: 40px;
		border: none;
		border-radius: var(--radius);
		background: var(--primary);
		color: var(--text-on-primary);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--transition);
	}

	.share-copy-btn:hover {
		opacity: 0.9;
	}

	.share-dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.share-dialog-close {
		background: none;
		border: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		cursor: pointer;
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		transition:
			background var(--transition),
			color var(--transition);
	}

	.share-dialog-close:hover {
		background: var(--surface-muted);
		color: var(--text);
	}

	.share-dialog-close :global(svg) {
		width: 20px;
		height: 20px;
	}
</style>
