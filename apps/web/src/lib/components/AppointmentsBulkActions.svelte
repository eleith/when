<!-- Bulk actions for the admin list: above the table on desktop, fixed to the bottom on mobile. -->
<script lang="ts">
	type BulkAction = 'delete' | 'cancel' | 'accept' | 'decline';

	interface Props {
		bucket: 'upcoming' | 'pending' | 'concluded' | 'archived' | 'purged';
		selectedCount: number;
		onAction: (action: BulkAction) => void;
	}

	let { bucket, selectedCount, onAction }: Props = $props();
</script>

<div class="bulk-actions-bar" class:has-selection={selectedCount > 0}>
	<div class="action-buttons">
		{#if bucket === 'concluded' || bucket === 'archived'}
			<button
				type="button"
				class="btn-outline btn-danger"
				disabled={selectedCount === 0}
				onclick={() => onAction('delete')}
			>
				Delete{#if selectedCount > 0}&nbsp;{selectedCount}{/if}
			</button>
		{:else if bucket === 'upcoming'}
			<button
				type="button"
				class="btn-outline btn-danger"
				disabled={selectedCount === 0}
				onclick={() => onAction('cancel')}
			>
				Cancel{#if selectedCount > 0}&nbsp;{selectedCount}{/if}
			</button>
		{:else if bucket === 'pending'}
			<button
				type="button"
				class="btn-outline btn-success"
				disabled={selectedCount === 0}
				onclick={() => onAction('accept')}
			>
				Accept{#if selectedCount > 0}&nbsp;{selectedCount}{/if}
			</button>
			<button
				type="button"
				class="btn-outline btn-danger"
				disabled={selectedCount === 0}
				onclick={() => onAction('decline')}
			>
				Decline{#if selectedCount > 0}&nbsp;{selectedCount}{/if}
			</button>
		{/if}
	</div>
</div>

<style>
	.bulk-actions-bar {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		padding: var(--space-3) var(--space-5);
		background: var(--when-color-surface-page);
		border-bottom: 1px solid var(--color-border);
	}

	.action-buttons {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.btn-outline {
		height: 36px;
		padding: 0 var(--space-4);
		font-size: var(--font-size-sm);
		font-weight: 600;
		background: transparent;
		border: 1px solid var(--color-border-strong);
		color: var(--color-text-secondary);
		border-radius: var(--radius);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		white-space: nowrap;
		transition:
			background var(--transition),
			color var(--transition),
			border-color var(--transition),
			opacity var(--transition),
			transform var(--transition);
	}

	.btn-outline:active:not(:disabled) {
		transform: scale(0.98);
	}

	.btn-outline:disabled {
		color: var(--color-text-disabled);
		border-color: var(--color-border);
		background: transparent;
		cursor: not-allowed;
		opacity: 0.6;
	}

	.btn-outline.btn-danger:not(:disabled) {
		color: var(--color-danger-strong);
		border-color: var(--color-danger-border);
	}

	.btn-outline.btn-danger:not(:disabled):hover {
		background: var(--color-danger-bg);
		border-color: var(--color-danger-strong);
	}

	.btn-outline.btn-success:not(:disabled) {
		color: var(--color-success-strong);
		border-color: var(--color-success-border);
	}

	.btn-outline.btn-success:not(:disabled):hover {
		background: var(--color-success-bg);
		border-color: var(--color-success-strong);
	}

	@media (max-width: 768px) {
		.bulk-actions-bar {
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			z-index: 100;
			padding: var(--space-4) var(--space-5);
			padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
			background: var(--color-surface);
			border-top: 1px solid var(--color-border);
			border-bottom: none;
			box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
			animation: bulk-bar-slide-up 0.2s ease-out;
		}

		.bulk-actions-bar:not(.has-selection) {
			display: none;
		}

		.action-buttons {
			width: 100%;
			gap: var(--space-4);
		}

		/* One row keeps the bar a constant height, which .bulk-bar-spacer depends on. */
		.btn-outline {
			flex: 1;
			height: auto;
			min-height: 56px;
			font-size: var(--font-size-md);
		}
	}

	@keyframes bulk-bar-slide-up {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
</style>
