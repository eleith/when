<!-- The admin list's bulk action bar: which actions a bucket offers, and the selection count. -->
<script lang="ts">
	type BulkAction = 'delete' | 'cancel' | 'accept' | 'decline';

	interface Props {
		bucket: 'upcoming' | 'pending' | 'concluded' | 'archived' | 'purged';
		selectedCount: number;
		onAction: (action: BulkAction) => void;
	}

	let { bucket, selectedCount, onAction }: Props = $props();
</script>

<div class="table-actions-bar">
	<span class="selected-count">
		{#if selectedCount > 0}
			{selectedCount} appointment{#if selectedCount !== 1}s{/if} selected
		{/if}
	</span>
	<div class="action-buttons">
		{#if bucket === 'concluded' || bucket === 'archived'}
			<button
				type="button"
				class="btn-outline btn-danger"
				disabled={selectedCount === 0}
				onclick={() => onAction('delete')}
			>
				Delete
			</button>
		{:else if bucket === 'upcoming'}
			<button
				type="button"
				class="btn-outline btn-danger"
				disabled={selectedCount === 0}
				onclick={() => onAction('cancel')}
			>
				Cancel
			</button>
		{:else if bucket === 'pending'}
			<button
				type="button"
				class="btn-outline btn-success"
				disabled={selectedCount === 0}
				onclick={() => onAction('accept')}
			>
				Accept
			</button>
			<button
				type="button"
				class="btn-outline btn-danger"
				disabled={selectedCount === 0}
				onclick={() => onAction('decline')}
			>
				Decline
			</button>
		{/if}
	</div>
</div>

<style>
	.table-actions-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-5);
		background: var(--when-color-surface-page);
		border-bottom: 1px solid var(--color-border);
	}

	.selected-count {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-secondary);
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
</style>
