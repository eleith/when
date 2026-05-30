<script lang="ts">
	import IconLockKey from 'virtual:icons/ph/lock-key';

	let { data } = $props();
</script>

<svelte:head>
	<title>Configuration — When</title>
</svelte:head>

<div class="section-header">
	<h1 class="page-title">Configuration</h1>
	<p class="page-subtitle">View system configuration and external integrations</p>
</div>

<div class="card config-card">
	<div class="config-info-banner">
		<IconLockKey class="info-icon" aria-hidden="true" />
		<p>Sensitive credentials and API secrets are masked for safety.</p>
	</div>
	<pre class="config-block"><code>{JSON.stringify(data.config, null, 2)}</code></pre>
</div>

<style>
	.section-header {
		margin-bottom: var(--space-6);
	}

	.page-title {
		font-size: var(--font-size-2xl);
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 var(--space-1);
	}

	.page-subtitle {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		margin: 0;
	}

	.config-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		padding: var(--space-5);
		overflow: hidden;
	}

	.config-info-banner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--surface-page);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}

	:global(.info-icon) {
		font-size: var(--font-size-md);
		color: var(--text-muted);
	}

	.config-info-banner p {
		margin: 0;
	}

	.config-block {
		margin: 0;
		padding: var(--space-4);
		background: var(--surface-page);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.config-block code {
		font-family: var(--font-mono, monospace);
		color: var(--text-secondary);
	}
</style>
