<!-- Warns that a deep-linked slot or day is no longer available. -->
<script lang="ts">
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import { formatDate, formatSlot } from '$lib/datetime';
	import type { DeepLinkResult } from '$lib/appointment';

	interface Props {
		notice: NonNullable<DeepLinkResult['notice']>;
		tz: string;
	}

	let { notice, tz }: Props = $props();
</script>

<aside class="card">
	<span class="icon"><IconWarningCircle aria-hidden="true" /></span>
	<div class="content">
		<span class="text">
			{#if notice.kind === 'slot'}
				<strong>{formatSlot(notice.requested, tz)}</strong> is no longer available. Pick another time
				below.
			{:else}
				<strong>{formatDate(notice.requested)}</strong> has no availability. Pick another day below.
			{/if}
		</span>
	</div>
</aside>

<style>
	.card {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-6);
		color: var(--when-color-text);
	}

	.icon {
		font-size: var(--font-size-xl);
		color: var(--warning);
		flex-shrink: 0;
		margin-top: 2px;
		display: inline-flex;
	}

	.content {
		flex: 1;
	}

	.text {
		font-size: var(--font-size-md);
		line-height: 1.5;
		color: var(--text-secondary);
	}

	.text strong {
		color: var(--when-color-text);
		font-weight: 600;
	}
</style>
