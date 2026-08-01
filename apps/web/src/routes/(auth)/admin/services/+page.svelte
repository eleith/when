<script lang="ts">
	import IconCheckCircle from 'virtual:icons/ph/check-circle';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconSpinner from 'virtual:icons/ph/spinner';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from './$types';

	interface DiscoveredCalendar {
		id: string;
		name: string;
		primary: boolean;
	}

	let { data, form } = $props();

	let listingProvider = $state('');
	let listing = $state<{ field: string; calendars: DiscoveredCalendar[] } | null>(null);

	// The provider round-trip is slow, so claim the section on submit and show a spinner
	// rather than leaving the click with no feedback.
	function listCalendars(provider: string): SubmitFunction {
		return () => {
			listingProvider = provider;
			listing = null;
			return async ({ result, update }) => {
				await update();
				if (result.type !== 'success') listingProvider = '';
			};
		};
	}

	$effect(() => {
		const discovered = form?.discovered;
		if (!discovered) return;
		listingProvider = discovered.provider;
		listing = { field: discovered.field, calendars: discovered.calendars };
	});

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
	<title>Services — When</title>
</svelte:head>

<section class="services">
	<h1 class="title">Services</h1>

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

	<h2 class="section">Calendar &amp; video</h2>

	{#if data.providers.length === 0}
		<p class="empty">No providers are configured in when.yaml.</p>
	{:else}
		<ul class="list">
			{#each data.providers as provider (provider.name)}
				{@const unconnected = provider.usesOAuth && !provider.connectedAt}
				<li class="card">
					<div class="body">
						<h2 class="name">{provider.name}</h2>

						<dl class="fields">
							<dt>Type</dt>
							<dd>{provider.type}</dd>

							<dt>Calendars</dt>
							<dd>{provider.calendars.length === 0 ? 'None' : provider.calendars.join(', ')}</dd>

							<dt>Status</dt>
							{#if unconnected}
								<dd>Not connected</dd>
							{:else if provider.observed.state === 'failing'}
								<dd class="failed">
									Failing{#if provider.observed.at}
										since {fmt(provider.observed.at)}{/if} — {provider.observed.error}
									{#if provider.observed.via === 'refresh'}(calendar refresh){:else if provider.observed.via === 'push'}(calendar
										push){:else if provider.observed.via === 'send'}(email send){:else if provider.observed.via === 'test'}(manual
										test){/if}
								</dd>
							{:else if provider.observed.state === 'working'}
								<dd class="ok">
									Working{#if provider.observed.at}
										— last confirmed {fmt(provider.observed.at)}{/if}
									{#if provider.observed.via === 'refresh'}(calendar refresh){:else if provider.observed.via === 'push'}(calendar
										push){:else if provider.observed.via === 'send'}(email send){:else if provider.observed.via === 'test'}(manual
										test){/if}
								</dd>
							{:else}
								<dd>Not yet observed — nothing has used this provider</dd>
							{/if}

							<dt>Calendars sync</dt>
							{#if provider.calendars.length === 0}
								<dd>No calendars configured</dd>
							{:else if provider.sync.health === 'bad'}
								<dd class="failed">{provider.sync.reason ?? 'Not syncing'}</dd>
							{:else if provider.sync.health === 'good'}
								<dd class="ok">
									Syncing{#if provider.sync.lastSyncedAt}
										— last at {fmt(provider.sync.lastSyncedAt)}{/if}
								</dd>
							{:else}
								<dd>Not yet refreshed</dd>
							{/if}

							<dt>{provider.endpoint.label}</dt>
							<dd><code>{provider.endpoint.url}</code></dd>
						</dl>

						{#if listingProvider === provider.name}
							<div class="found">
								<h3 class="found-title">Available calendars</h3>
								{#if !listing}
									<p class="found-loading">
										<span class="spinner"><IconSpinner aria-hidden="true" /></span>
										Asking {provider.name}…
									</p>
								{:else if listing.calendars.length === 0}
									<p class="found-empty">This provider exposes no calendars.</p>
								{:else}
									<ul class="found-list">
										{#each listing.calendars as calendar (calendar.id)}
											<li class="found-item">
												<span class="found-name">{calendar.name}</span>
												<code class="found-value">{listing.field}: {calendar.id}</code>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
					</div>

					<div class="actions">
						<div class="actions-change">
							{#if unconnected}
								<form method="POST" action="?/connect">
									<input type="hidden" name="provider" value={provider.name} />
									<button type="submit" class="button primary">Connect</button>
								</form>
							{:else if provider.connectedAt}
								<form method="POST" action="?/disconnect">
									<input type="hidden" name="provider" value={provider.name} />
									<button type="submit" class="button danger">Disconnect</button>
								</form>
							{/if}
						</div>
						{#if !unconnected}
							<div class="actions-check">
								<form method="POST" action="?/calendars" use:enhance={listCalendars(provider.name)}>
									<input type="hidden" name="provider" value={provider.name} />
									<button type="submit" class="button">List calendars</button>
								</form>
								<form method="POST" action="?/test">
									<input type="hidden" name="provider" value={provider.name} />
									<button type="submit" class="button">Test</button>
								</form>
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="section">Email</h2>

	<div class="card">
		<div class="body">
			<h3 class="name">{data.smtp.host}</h3>

			<dl class="fields">
				<dt>Status</dt>
				{#if data.smtp.observed.state === 'failing'}
					<dd class="failed">
						Failing{#if data.smtp.observed.at}
							since {fmt(data.smtp.observed.at)}{/if} — {data.smtp.observed.error}
					</dd>
				{:else if data.smtp.observed.state === 'working'}
					<dd class="ok">
						Working{#if data.smtp.observed.at}
							— last confirmed {fmt(data.smtp.observed.at)}{/if}
					</dd>
				{:else}
					<dd>Not yet observed — no email has been sent</dd>
				{/if}

				<dt>Port</dt>
				<dd>{data.smtp.port}</dd>

				<dt>Username</dt>
				<dd>{data.smtp.user}</dd>

				<dt>Sends as</dt>
				<dd><code>{data.smtp.sender}</code></dd>
			</dl>
		</div>

		<div class="actions">
			<form method="POST" action="?/email" class="email-form">
				<label class="email-label" for="test-recipient">Send a test email to</label>
				<input
					id="test-recipient"
					class="email-input"
					type="email"
					name="to"
					value={data.smtp.defaultRecipient}
					required
				/>
				<button type="submit" class="button">Send</button>
			</form>
		</div>
	</div>
</section>

<style>
	.services {
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

	.section {
		margin: var(--space-8) 0 var(--space-5);
		font-size: var(--font-size-sm);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.section:first-of-type {
		margin-top: 0;
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

	.found {
		border-top: 1px solid var(--color-border);
		padding-top: var(--space-4);
	}

	.found-title {
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-md);
		font-weight: 400;
		color: var(--when-color-text);
	}

	.found-loading {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
	}

	.spinner {
		display: inline-flex;
		animation: found-spin 0.9s linear infinite;
	}

	@keyframes found-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.found-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.found-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.found-name {
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.found-value {
		font-size: var(--font-size-md);
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
		user-select: all;
	}

	.found-empty {
		margin: 0;
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
	}

	.failed {
		color: var(--color-danger);
	}

	.ok {
		color: var(--color-success);
	}

	/* Changing a connection sits left; the read-only check sits right. */
	.actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border-top: 1px solid var(--color-border);
		background: var(--color-surface-muted);
	}

	.actions-change,
	.actions-check {
		display: flex;
		gap: var(--space-3);
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

	.primary {
		border-color: var(--when-color-primary);
		color: var(--when-color-primary);
	}

	.danger {
		color: var(--color-danger);
	}

	.danger:hover {
		background: var(--color-danger-bg);
	}

	.email-form {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		width: 100%;
	}

	.email-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.email-input {
		flex: 1;
		min-width: 12rem;
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		font-size: var(--font-size-base);
		color: var(--when-color-text);
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
