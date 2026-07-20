<!-- Desktop-only sidebar: provider, event summary, and current step. Hidden on mobile. -->
<script lang="ts">
	import type { Appearance } from '@when/config';
	import type { WizardStep } from '$lib/appointment';

	interface Props {
		appearance: Appearance;
		providerName: string;
		eventName: string;
		eventDescription?: string | null;
		step: WizardStep;
	}

	let { appearance, providerName, eventName, eventDescription, step }: Props = $props();
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
		<h1 class="event-name">{eventName}</h1>
		{#if eventDescription}
			<p class="event-description">{eventDescription}</p>
		{/if}
	</section>

	<section class="step">
		<span class="step-label">Step {step} of 3</span>
		<h2 class="step-title">
			{#if step === 1}Pick a day{:else if step === 2}Pick a time{:else}Enter your info{/if}
		</h2>
	</section>
</aside>

<style>
	.sidebar {
		flex: 0 0 30%;
		padding: var(--space-7);
		border-right: 1px solid var(--border);
		background: var(--surface-muted);
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
		border: solid 2px var(--text);
		transition: opacity var(--transition);
	}

	.event-name {
		font-size: var(--font-size-xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
		color: var(--text);
	}

	.event-description {
		color: var(--text-secondary);
		font-size: var(--font-size-sm);
		margin: 0;
		line-height: 1.5;
	}

	.step {
		margin-top: auto;
		padding-top: var(--space-6);
		border-top: 1px solid var(--border-strong);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.step-label {
		font-size: var(--font-size-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}

	.step-title {
		margin: 0;
		font-size: var(--font-size-md);
		font-weight: 700;
		color: var(--text);
	}

	@media (max-width: 768px) {
		.sidebar {
			display: none;
		}
	}
</style>
