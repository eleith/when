<script lang="ts">
	import IconCheckCircle from 'virtual:icons/ph/check-circle';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';

	let { data, form } = $props();

	function fmt(iso: string): string {
		return new Date(iso).toLocaleString([], {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Calendars — When</title>
</svelte:head>

<section class="calendars">
	<h1 class="title">Calendars</h1>

	{#if form?.notice}
		<aside class="banner banner-{form.notice.tone}" role="alert">
			<span class="banner-icon">
				{#if form.notice.tone === 'success'}
					<IconCheckCircle aria-hidden="true" />
				{:else}
					<IconWarningCircle aria-hidden="true" />
				{/if}
			</span>
			<p class="banner-text">{form.notice.text}</p>
		</aside>
	{/if}

	{#if data.calendars.length === 0}
		<p class="empty">No calendars are configured in when.yaml.</p>
	{:else}
		<ul class="list">
			{#each data.calendars as calendar (calendar.name)}
				<li class="card">
					<div class="body">
						<h2 class="name">{calendar.name}</h2>

						<dl class="fields">
							<dt>Type</dt>
							<dd>{calendar.type}</dd>

							<dt>Provider</dt>
							<dd>{calendar.provider}</dd>

							<dt>Status</dt>
							{#if calendar.health === 'bad'}
								<dd class="failed">{calendar.reason ?? 'Not syncing'}</dd>
							{:else if calendar.health === 'good'}
								<dd class="ok">
									Syncing{#if calendar.lastSyncedAt}
										— last at {fmt(calendar.lastSyncedAt)}{/if}
								</dd>
							{:else}
								<dd>Not synced yet</dd>
							{/if}

							<dt>Refreshes</dt>
							<dd>every {calendar.refreshEveryMinutes} min</dd>

							<dt>{calendar.target.label}</dt>
							<dd><code>{calendar.target.value}</code></dd>
						</dl>
					</div>

					<div class="actions">
						<form method="POST" action="?/test">
							<input type="hidden" name="calendar" value={calendar.name} />
							<button type="submit" class="button">Test</button>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.calendars {
		padding: var(--space-8) 0;
		max-width: 42rem;
		margin: 0 auto;
	}

	.title {
		margin: 0 0 var(--space-7);
		font-size: var(--font-size-2xl);
		color: var(--when-color-text);
	}

	.banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		margin: 0 0 var(--space-6);
		padding: var(--space-5) var(--space-6);
		border: 1px solid;
		border-radius: var(--radius-md);
		color: var(--color-text-secondary);
		font-size: var(--font-size-md);
		line-height: 1.5;
	}

	.banner-icon {
		font-size: var(--font-size-xl);
		flex-shrink: 0;
		margin-top: 2px;
		display: inline-flex;
	}

	.banner-text {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.banner-error {
		background: var(--color-danger-bg);
		border-color: var(--color-danger-border);
	}

	.banner-error .banner-icon {
		color: var(--color-danger);
	}

	.banner-success {
		background: var(--color-success-bg);
		border-color: var(--color-success-border);
	}

	.banner-success .banner-icon {
		color: var(--color-success);
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.card {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		overflow: hidden;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5);
	}

	.name {
		margin: 0;
		font-size: var(--font-size-lg);
		font-weight: 500;
		color: var(--when-color-text);
		overflow-wrap: anywhere;
	}

	.fields {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: var(--space-2) var(--space-4);
		margin: 0;
		font-size: var(--font-size-md);
	}

	.fields dt {
		color: var(--color-text-muted);
	}

	.fields dd {
		margin: 0;
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
	}

	.fields code {
		user-select: all;
	}

	.failed {
		color: var(--color-danger);
	}

	.ok {
		color: var(--color-success);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border-top: 1px solid var(--color-border);
		background: var(--color-surface-muted);
	}

	.button {
		padding: var(--space-3) var(--space-5);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		font-size: var(--font-size-base);
		color: var(--when-color-text);
		cursor: pointer;
	}

	.button:hover {
		background: var(--color-surface-active);
	}

	.empty {
		margin: 0;
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
	}

	@media (max-width: 640px) {
		.fields {
			grid-template-columns: 1fr;
			gap: 0;
		}

		.fields dt {
			margin-top: var(--space-3);
		}
	}
</style>
