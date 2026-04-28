<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.user.name} | When</title>
</svelte:head>

<main class="landing">
	{#if data.user.branding?.avatar_url || data.user.branding?.logo_url}
		<img src={data.user.branding?.avatar_url || data.user.branding?.logo_url} alt={data.user.name} class="avatar" />
	{/if}
	<h1>{data.user.branding?.page_title || data.user.name}</h1>
	{#if data.user.branding?.descriptionHtml}
		<div class="subtitle">{@html data.user.branding.descriptionHtml}</div>
	{:else if !data.user.branding?.page_title}
		<p class="subtitle">Welcome to my scheduling page</p>
	{/if}

	{#if data.eventTypes.length === 0}
		<p class="empty">No meeting types are currently available.</p>
	{:else}
		<div class="event-list">
			{#each data.eventTypes as et (et.id)}
				<a href="/schedule/{et.slug}" class="event-card">
					{#if et.image_url}
						<img src={et.image_url} alt="" class="event-image" />
					{:else}
						<span class="event-dot"></span>
					{/if}
					<div class="event-info">
						<h2>{et.name}</h2>
						<p class="event-meta">{et.duration} min</p>
						{#if et.descriptionHtml}
							<div class="event-desc">{@html et.descriptionHtml}</div>
						{/if}
					</div>
					<span class="arrow" aria-hidden="true">&rarr;</span>
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
		color: var(--text);
	}

	.avatar {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		object-fit: cover;
		margin-bottom: var(--space-5);
	}

	h1 {
		font-size: var(--font-size-3xl);
		font-weight: 700;
		margin: 0 0 var(--space-2);
	}

	.subtitle {
		color: var(--text-muted);
		margin: 0 0 var(--space-8);
	}

	.empty {
		color: var(--text-muted);
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
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--space-6) var(--space-6);
		text-decoration: none;
		color: inherit;
		transition:
			border-color var(--transition),
			box-shadow var(--transition);
	}

	.event-card:hover {
		border-color: var(--accent);
		box-shadow: var(--shadow-card);
	}

	.event-dot {
		flex-shrink: 0;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--accent);
	}

	.event-image {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		border-radius: var(--radius);
		object-fit: cover;
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
		color: var(--text-muted);
		font-size: var(--font-size-base);
		margin: var(--space-1) 0 0;
	}

	.event-desc {
		color: var(--text-muted);
		font-size: var(--font-size-base);
		margin: var(--space-2) 0 0;
		line-height: 1.4;
	}

	.arrow {
		color: var(--text-disabled);
		font-size: var(--font-size-xl);
		flex-shrink: 0;
	}
</style>
