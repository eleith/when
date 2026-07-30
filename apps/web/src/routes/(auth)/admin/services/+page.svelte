<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head>
	<title>Services — When</title>
</svelte:head>

<section class="services">
	<h1 class="title">Services</h1>

	{#if form?.error}
		<p class="banner banner-error">{form.error}</p>
	{/if}

	{#if data.services.length === 0}
		<p class="empty">No google services are configured in when.yaml.</p>
	{:else}
		<p class="lede">
			Register this redirect URI on each OAuth client in Google Cloud Console:
			<code class="redirect">{data.redirectUri}</code>
		</p>

		<ul class="list">
			{#each data.services as service (service.name)}
				<li class="row">
					<div class="identity">
						<span class="name">{service.name}</span>
						{#if service.lastError}
							<span class="state state-error">Reconnect needed</span>
						{:else if service.connectedAt}
							<span class="state state-ok">Connected</span>
						{:else}
							<span class="state">Not connected</span>
						{/if}
					</div>

					{#if service.lastError}
						<p class="reason">{service.lastError}</p>
					{/if}

					<form method="POST" action="?/connect">
						<input type="hidden" name="service" value={service.name} />
						<button type="submit" class="connect">
							{#if service.connectedAt}Reconnect{:else}Connect{/if}
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.services {
		padding: var(--space-8) 0;
		max-width: 42rem;
	}

	.title {
		margin: 0 0 var(--space-4);
		font-size: var(--font-size-2xl);
		color: var(--when-color-text);
	}

	.lede {
		margin: 0 0 var(--space-7);
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	.redirect {
		display: block;
		margin-top: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow-wrap: anywhere;
		user-select: all;
	}

	.banner {
		margin: 0 0 var(--space-6);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		font-size: var(--font-size-sm);
	}

	.banner-error {
		background: var(--color-danger-bg);
		border: 1px solid var(--color-danger-border);
		color: var(--color-danger-strong);
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.identity {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.name {
		font-size: var(--font-size-md);
		color: var(--when-color-text);
	}

	.state {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.state-ok {
		color: var(--color-success);
	}

	.state-error {
		color: var(--color-danger);
	}

	.reason {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.connect {
		align-self: flex-start;
		padding: var(--space-3) var(--space-6);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		font-size: var(--font-size-base);
		color: var(--when-color-text);
		cursor: pointer;
	}

	.connect:hover {
		background: var(--color-surface-active);
	}

	.empty {
		margin: 0;
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
	}
</style>
