<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import IconDotsThreeVertical from 'virtual:icons/ph/dots-three-vertical';

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

	let rescheduleHref = $derived(
		`/booked/${appointmentId}/reschedule?token=${encodeURIComponent(token)}`
	);

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
				aria-label="Booking actions"
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
</style>
