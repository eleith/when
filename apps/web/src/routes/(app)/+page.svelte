<script lang="ts">
	import IconArrowRight from 'virtual:icons/ph/arrow-right';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.user.name} | When</title>
</svelte:head>

<main class="landing">
	{#if data.user.appearance.avatar_url}
		<img src={data.user.appearance.avatar_url} alt={data.user.name} class="avatar" />
	{/if}
	<h1>{data.user.appearance.title}</h1>
	<p class="subtitle">{data.user.appearance.description}</p>

	{#if data.eventTypes.length === 0}
		<p class="empty">No meeting types are currently available.</p>
	{:else}
		<div class="event-list">
			{#each data.eventTypes as et (et.id)}
				<a href="/schedule/{et.slug}" class="event-card">
					<div class="event-info">
						<h2>{et.name}</h2>
						{#if et.description}
							<p class="event-meta">{et.description}</p>
						{/if}
					</div>
					<span class="arrow"><IconArrowRight aria-hidden="true" /></span>
				</a>
			{/each}
		</div>
	{/if}
</main>

<style>
	.landing {
		max-width: 640px;
		margin: 0 auto;
		padding: var(--space-9) var(--space-7);
		color: var(--when-color-text);
	}

	.avatar {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		object-fit: cover;
		border: 3px solid var(--when-color-text);
		margin-bottom: var(--space-5);
	}

	h1 {
		font-size: var(--font-size-3xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
	}

	.subtitle {
		color: var(--color-text-muted);
		margin: 0 0 var(--space-8);
	}

	.empty {
		color: var(--color-text-muted);
	}

	.event-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.event-card {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--space-6) var(--space-6);
		text-decoration: none;
		color: inherit;
		min-height: calc(var(--space-10) * 2);
		transition:
			border-color var(--transition),
			box-shadow var(--transition);
	}

	.event-card:hover {
		border-color: var(--when-color-primary);
		box-shadow: var(--shadow-card);
	}

	.event-card:hover .arrow {
		color: var(--when-color-primary);
	}

	.event-info {
		flex: 1;
		min-width: 0;
	}

	.event-info h2 {
		font-size: var(--font-size-lg);
		font-weight: 600;
		margin: 0;
	}

	.event-meta {
		color: var(--color-text-secondary);
		font-size: var(--font-size-base);
		margin: var(--space-1) 0 0;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		line-clamp: 3;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.arrow {
		color: var(--color-text-disabled);
		font-size: var(--font-size-xl);
		flex-shrink: 0;
		transition: color var(--transition);
		display: inline-flex;
	}
</style>
