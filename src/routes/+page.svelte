<script lang="ts">
	let { data } = $props();
	let accent = $derived(data.user.branding?.accent_color ?? '#4f46e5');
</script>

<svelte:head>
	<title>{data.user.name} | When</title>
</svelte:head>

<main class="landing" style="--accent: {accent}">
	{#if data.user.branding?.logo_url}
		<img src={data.user.branding.logo_url} alt={data.user.name} class="avatar" />
	{/if}
	<h1>{data.user.name}</h1>
	<p class="subtitle">Welcome to my scheduling page</p>

	{#if data.eventTypes.length === 0}
		<p class="empty">No meeting types are currently available.</p>
	{:else}
		<div class="event-list">
			{#each data.eventTypes as et (et.id)}
				<a href="/schedule/{et.slug}" class="event-card">
					<span class="event-dot"></span>
					<div class="event-info">
						<h2>{et.name}</h2>
						<p class="event-meta">{et.duration} min</p>
						{#if et.description}
							<p class="event-desc">{et.description}</p>
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
		padding: 48px 24px;
		font-family:
			-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
		color: #111827;
	}

	.avatar {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		object-fit: cover;
		margin-bottom: 16px;
	}

	h1 {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 0 0 4px;
	}

	.subtitle {
		color: #6b7280;
		margin: 0 0 32px;
	}

	.empty {
		color: #6b7280;
	}

	.event-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.event-card {
		display: flex;
		align-items: center;
		gap: 14px;
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 18px 20px;
		text-decoration: none;
		color: inherit;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.event-card:hover {
		border-color: var(--accent);
		box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06);
	}

	.event-dot {
		flex-shrink: 0;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--accent);
	}

	.event-info {
		flex: 1;
		min-width: 0;
	}

	.event-info h2 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
	}

	.event-meta {
		color: #6b7280;
		font-size: 0.875rem;
		margin: 2px 0 0;
	}

	.event-desc {
		color: #6b7280;
		font-size: 0.875rem;
		margin: 4px 0 0;
		line-height: 1.4;
	}

	.arrow {
		color: #9ca3af;
		font-size: 1.25rem;
		flex-shrink: 0;
	}
</style>
