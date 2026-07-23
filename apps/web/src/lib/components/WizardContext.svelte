<!-- Desktop-only sidebar: provider and event summary. Hidden on mobile. -->
<script lang="ts">
	import type { Appearance } from '@when/config';

	interface Props {
		appearance: Appearance;
		providerName: string;
		eventName: string;
		eventDescription?: string | null;
	}

	let { appearance, providerName, eventName, eventDescription }: Props = $props();
</script>

<aside class="sidebar">
	<section class="section">
		<a href="/" class="provider">
			{#if appearance.avatar_url}
				<img src={appearance.avatar_url} alt={providerName} class="avatar" />
			{/if}
		</a>
	</section>

	<section class="section">
		<p class="event-name">{eventName}</p>
		{#if eventDescription}
			<p class="event-description">{eventDescription}</p>
		{/if}
	</section>
</aside>

<style>
	.sidebar {
		flex: 0 0 30%;
		padding: var(--space-7);
		border-right: 1px solid var(--color-border);
		background: var(--color-surface-muted);
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.provider {
		display: inline-flex;
		text-decoration: none;
		color: inherit;
	}

	.provider:hover .avatar {
		opacity: 0.8;
	}

	.avatar {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		border-radius: 50%;
		object-fit: cover;
		border: solid 2px var(--when-color-text);
		transition: opacity var(--transition);
	}

	.event-name {
		font-size: var(--font-size-lg);
		font-weight: 600;
		margin: 0 0 var(--space-2);
		color: var(--when-color-text);
	}

	.event-description {
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		margin: 0;
		line-height: 1.5;
	}

	@media (max-width: 768px) {
		.sidebar {
			display: none;
		}
	}
</style>
