<!-- Shown above the wizard when the guest is rescheduling an existing appointment. -->
<script lang="ts">
	import IconInfo from 'virtual:icons/ph/info';
	import { formatSlot } from '$lib/datetime';

	interface Props {
		previousHref: string;
		startTime: string;
		tz: string;
	}

	let { previousHref, startTime, tz }: Props = $props();
</script>

<aside class="banner">
	<span class="icon"><IconInfo aria-hidden="true" /></span>
	<span class="text">
		Rescheduling <a class="link" href={previousHref}>previous appointment</a>
		for {formatSlot(startTime, tz)}.
	</span>
</aside>

<style>
	.banner {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		margin-bottom: var(--space-6);
		background: var(--color-info-bg);
		border: 1px solid var(--color-info-border);
		border-radius: var(--radius-md);
	}

	.icon {
		font-size: var(--font-size-xl);
		color: var(--color-info-strong);
		flex-shrink: 0;
		display: inline-flex;
	}

	.text {
		font-size: var(--font-size-md);
		line-height: 1.4;
		color: var(--when-color-text);
	}

	.link {
		color: var(--color-info-strong);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.link:hover {
		text-decoration: none;
	}
</style>
