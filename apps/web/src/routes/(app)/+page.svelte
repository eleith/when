<script lang="ts">
	import AdminNav from '$lib/components/AdminNav.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{data.user.name} | When</title>
</svelte:head>

{#if data.isAdmin}
	<AdminNav />
{/if}

<main class="landing">
	{#if data.user.appearance.avatar_path}
		<img src={data.user.appearance.avatar_path} alt={data.user.name} class="avatar" />
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
					<div class="event-duration">
						<span class="duration-value" aria-hidden="true">
							{#if et.durations.length > 2}
								{et.durations[0]} or … {et.durations[et.durations.length - 1]}
							{:else}
								{et.durations.join(' or ')}
							{/if}
						</span>
						<span class="duration-unit" aria-hidden="true">min</span>
						<span class="visibility-hidden">
							{#if et.durations.length > 2}
								{et.durations.length} lengths between {et.durations[0]} and {et.durations[
									et.durations.length - 1
								]} minutes
							{:else}
								{et.durations.join(' or ')} minutes
							{/if}
						</span>
					</div>
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
		gap: var(--space-6);
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
		min-height: calc(var(--space-10) * 2 + var(--space-3));
		transition:
			border-color var(--transition),
			box-shadow var(--transition);
	}

	.event-card:hover {
		border-color: var(--when-color-primary);
		box-shadow: var(--shadow-card);
	}

	.event-card:hover .event-info h2,
	.event-card:hover .event-duration {
		color: var(--when-color-primary);
	}

	.event-info {
		flex: 1;
		min-width: 0;
	}

	.event-info h2 {
		font-size: var(--font-size-xl);
		font-weight: 600;
		line-height: 1.25;
		margin: 0;
		transition: color var(--transition);
	}

	.event-meta {
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		margin: var(--space-3) 0 0;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		-webkit-box-orient: vertical;
		line-clamp: 3;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.event-duration {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		min-width: calc(var(--space-10) + var(--space-8));
		flex-shrink: 0;
		color: var(--color-text-secondary);
		line-height: 1;
		transition: color var(--transition);
	}

	.duration-value {
		font-size: var(--font-size-base);
		font-weight: 600;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.duration-unit {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
