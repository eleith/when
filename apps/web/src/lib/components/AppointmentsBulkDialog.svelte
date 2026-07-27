<!-- Confirmation sheet for a bulk action, posting the selected ids to the matching form action. -->
<script lang="ts">
	import IconX from 'virtual:icons/ph/x';
	import { Dialog } from 'bits-ui';

	interface Props {
		open: boolean;
		action: 'delete' | 'cancel' | 'accept' | 'decline';
		selectedIds: string[];
	}

	let { open = $bindable(), action, selectedIds }: Props = $props();

	let cancelReason = $state('I can no longer attend');
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay>
			{#snippet child({ props: overlayProps })}
				<div {...overlayProps} class="dialog-overlay"></div>
			{/snippet}
		</Dialog.Overlay>
		<Dialog.Content>
			{#snippet child({ props: dialogProps })}
				<div {...dialogProps} class="dialog-content bulk-actions-dialog">
					<header class="dialog-header">
						<Dialog.Title>
							{#snippet child({ props: titleProps })}
								<h2 {...titleProps} class="dialog-title">
									{#if action === 'delete'}
										Delete {selectedIds.length} Appointment{#if selectedIds.length !== 1}s{/if}?
									{:else if action === 'cancel'}
										Cancel {selectedIds.length} Appointment{#if selectedIds.length !== 1}s{/if}?
									{:else if action === 'accept'}
										Accept {selectedIds.length} Appointment{#if selectedIds.length !== 1}s{/if}?
									{:else if action === 'decline'}
										Decline {selectedIds.length} Appointment{#if selectedIds.length !== 1}s{/if}?
									{/if}
								</h2>
							{/snippet}
						</Dialog.Title>
						<Dialog.Close>
							{#snippet child({ props: closeProps })}
								<button {...closeProps} class="dialog-close" aria-label="Close">
									<IconX class="icon-close" />
								</button>
							{/snippet}
						</Dialog.Close>
					</header>

					{#if action === 'delete'}
						<p class="dialog-desc">
							Are you sure you want to delete these {selectedIds.length} selected appointments?
							<strong
								>This will delete the entire rescheduling chain for each of these appointments.</strong
							> This action cannot be undone.
						</p>
						<form method="POST" action="/admin/appointments?/bulkDelete" class="dialog-actions">
							{#each selectedIds as id (id)}
								<input type="hidden" name="ids" value={id} />
							{/each}
							<button type="submit" class="btn-confirm btn-confirm-danger">Yes, delete</button>
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<button {...closeProps} type="button" class="btn-cancel">Cancel</button>
								{/snippet}
							</Dialog.Close>
						</form>
					{:else if action === 'cancel'}
						<p class="dialog-desc">
							Are you sure you want to cancel these {selectedIds.length} selected appointments?
						</p>
						<form method="POST" action="/admin/appointments?/bulkCancel" class="dialog-form">
							{#each selectedIds as id (id)}
								<input type="hidden" name="ids" value={id} />
							{/each}
							<div class="form-group">
								<label for="cancel-reason" class="form-label">Reason for cancelling</label>
								<textarea
									id="cancel-reason"
									name="reason"
									bind:value={cancelReason}
									class="form-textarea"
									required
								></textarea>
							</div>
							<div class="dialog-actions">
								<button type="submit" class="btn-confirm btn-confirm-danger">Yes, cancel</button>
								<Dialog.Close>
									{#snippet child({ props: closeProps })}
										<button {...closeProps} type="button" class="btn-cancel">Cancel</button>
									{/snippet}
								</Dialog.Close>
							</div>
						</form>
					{:else if action === 'accept'}
						<p class="dialog-desc">
							Are you sure you want to accept these {selectedIds.length} selected pending appointments?
						</p>
						<form method="POST" action="/admin/appointments?/bulkAccept" class="dialog-actions">
							{#each selectedIds as id (id)}
								<input type="hidden" name="ids" value={id} />
							{/each}
							<button type="submit" class="btn-confirm btn-confirm-success">Yes, accept</button>
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<button {...closeProps} type="button" class="btn-cancel">Cancel</button>
								{/snippet}
							</Dialog.Close>
						</form>
					{:else if action === 'decline'}
						<p class="dialog-desc">
							Are you sure you want to decline these {selectedIds.length} selected pending appointments?
						</p>
						<form method="POST" action="/admin/appointments?/bulkDecline" class="dialog-actions">
							{#each selectedIds as id (id)}
								<input type="hidden" name="ids" value={id} />
							{/each}
							<button type="submit" class="btn-confirm btn-confirm-danger">Yes, decline</button>
							<Dialog.Close>
								{#snippet child({ props: closeProps })}
									<button {...closeProps} type="button" class="btn-cancel">Cancel</button>
								{/snippet}
							</Dialog.Close>
						</form>
					{/if}
				</div>
			{/snippet}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

<style>
	.dialog-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 200;
		animation: bulk-fade-in 0.15s ease-out;
	}

	.dialog-content.bulk-actions-dialog {
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
		padding: var(--space-6);
		gap: var(--space-5);
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12);
		animation: bulk-slide-up 0.2s ease-out;
	}

	@media (min-width: 769px) {
		.dialog-content.bulk-actions-dialog {
			top: 50%;
			bottom: auto;
			left: 50%;
			right: auto;
			width: 460px;
			max-width: calc(100vw - var(--space-7) * 2);
			transform: translate(-50%, -50%);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-md);
			animation: bulk-fade-up-desktop 0.2s ease-out;
		}
	}

	@keyframes bulk-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes bulk-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	@keyframes bulk-fade-up-desktop {
		from {
			transform: translate(-50%, calc(-50% + 8px));
			opacity: 0;
		}
		to {
			transform: translate(-50%, -50%);
			opacity: 1;
		}
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.dialog-title {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: 700;
	}

	.dialog-close {
		background: none;
		border: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: var(--space-2);
		border-radius: var(--radius-sm);
		transition:
			background var(--transition),
			color var(--transition);
	}

	.dialog-close:hover {
		background: var(--color-surface-muted);
		color: var(--when-color-text);
	}

	.dialog-close :global(svg) {
		width: 20px;
		height: 20px;
	}

	.dialog-desc {
		color: var(--color-text-secondary);
		font-size: var(--font-size-md);
		line-height: 1.5;
		margin: 0;
	}

	.dialog-actions {
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
		margin-top: var(--space-4);
	}

	.dialog-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.form-label {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--when-color-text);
	}

	.form-textarea {
		width: 100%;
		height: 80px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--when-color-text);
		font-size: var(--font-size-base);
		font-family: inherit;
		resize: none;
	}

	.form-textarea:focus {
		outline: none;
		border-color: var(--when-color-primary);
	}

	.btn-confirm {
		height: 40px;
		padding: 0 var(--space-4);
		border: none;
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--transition);
	}

	.btn-confirm:hover {
		opacity: 0.9;
	}

	.btn-confirm-danger {
		background: var(--color-danger);
		color: var(--when-color-text-on-primary);
	}

	.btn-confirm-success {
		background: var(--color-success);
		color: var(--when-color-text-on-primary);
	}

	.btn-cancel {
		height: 40px;
		padding: 0 var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--when-color-text);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition: background var(--transition);
	}

	.btn-cancel:hover {
		background: var(--color-surface-muted);
	}
</style>
