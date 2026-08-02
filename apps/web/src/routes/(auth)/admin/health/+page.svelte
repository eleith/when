<script lang="ts">
	import IconCheckCircle from 'virtual:icons/ph/check-circle';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconSpinner from 'virtual:icons/ph/spinner';
	import { enhance } from '$app/forms';
	import { timeAgo } from '$lib/datetime';
	import type { SubmitFunction } from './$types';

	interface DiscoveredCalendar {
		id: string;
		name: string;
		primary: boolean;
	}

	let { data, form } = $props();

	let listingProvider = $state('');
	let listing = $state<{ field: string; calendars: DiscoveredCalendar[] } | null>(null);

	let pending = $state('');
	let pendingTarget = $derived(
		pending.includes(':') ? pending.slice(pending.indexOf(':') + 1) : pending
	);

	// These round-trips reach a provider through the worker, so claim the button on submit
	// rather than leaving the click with no feedback.
	function run(key: string): SubmitFunction {
		return () => {
			pending = key;
			return async ({ update }) => {
				await update();
				pending = '';
			};
		};
	}

	function listCalendars(provider: string): SubmitFunction {
		return () => {
			pending = `discover:provider:${provider}`;
			listingProvider = provider;
			listing = null;
			return async ({ result, update }) => {
				await update();
				pending = '';
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
</script>

<svelte:head>
	<title>Health — When</title>
</svelte:head>

{#snippet notice(
	target: string,
	kind: 'provider' | 'calendar' | 'worker' | 'smtp',
	problem: string | null = null
)}
	{@const outcome = form?.notice?.for === target ? form.notice : null}
	{#if pendingTarget !== target && (outcome || problem)}
		{@const ok = outcome?.status === 'up'}
		<aside class="banner banner-{ok ? 'success' : 'error'}" role="alert">
			<span class="banner-icon">
				{#if ok}
					<IconCheckCircle aria-hidden="true" />
				{:else}
					<IconWarningCircle aria-hidden="true" />
				{/if}
			</span>
			<p class="banner-text">
				{#if !outcome}
					down: {problem}
				{:else if outcome.status === 'up' && kind === 'smtp'}
					up: test email sent to {outcome.detail}
				{:else if outcome.status === 'up' && kind === 'calendar'}
					up: {outcome.detail}
				{:else if outcome.status === 'up'}
					up
				{:else if kind === 'worker'}
					down: not reachable at {outcome.detail}
				{:else}
					down: {outcome.detail}
				{/if}
			</p>
		</aside>
	{/if}
{/snippet}

<section class="services">
	<h1 class="title">Health</h1>

	<h2 class="section" id="providers">Providers</h2>

	{#if data.providers.length === 0}
		<p class="empty">No providers are configured in when.yaml.</p>
	{:else}
		<ul class="list">
			{#each data.providers as provider (provider.name)}
				{@const unconnected = provider.usesOAuth && !provider.connectedAt}
				<li class="card">
					{@render notice(
						`provider:${provider.name}`,
						'provider',
						provider.observed.state === 'failing' ? provider.observed.error : null
					)}

					<div class="body">
						<h2 class="name">{provider.name}</h2>

						<dl class="fields">
							<dt>Type</dt>
							<dd>{provider.type}</dd>

							<dt>Calendars</dt>
							<dd>{provider.calendars.length}</dd>

							<dt>Status</dt>
							{#if unconnected}
								<dd>Not connected</dd>
							{:else if provider.observed.state === 'failing'}
								<dd class="failed">down ({timeAgo(provider.observed.at)})</dd>
							{:else if provider.observed.state === 'working'}
								<dd class="ok">up ({timeAgo(provider.observed.at)})</dd>
							{:else}
								<dd>not observed</dd>
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
								<form method="POST" action="/admin/services/google/connect">
									<input type="hidden" name="provider" value={provider.name} />
									<button type="submit" class="button primary">Connect</button>
								</form>
							{:else if provider.connectedAt}
								<form method="POST" action="/admin/services/google/disconnect">
									<input type="hidden" name="provider" value={provider.name} />
									<button type="submit" class="button danger">Disconnect</button>
								</form>
							{/if}
						</div>
						{#if !unconnected}
							<div class="actions-check">
								<form method="POST" action="?/discover" use:enhance={listCalendars(provider.name)}>
									<input type="hidden" name="provider" value={provider.name} />
									<button
										type="submit"
										class="button"
										disabled={pending === `discover:provider:${provider.name}`}
									>
										List calendars
									</button>
								</form>
								<form
									method="POST"
									action="?/testProvider"
									use:enhance={run(`test:provider:${provider.name}`)}
								>
									<input type="hidden" name="provider" value={provider.name} />
									<button
										type="submit"
										class="button"
										disabled={pending === `test:provider:${provider.name}`}
									>
										{#if pending === `test:provider:${provider.name}`}
											<span class="spinner"><IconSpinner aria-hidden="true" /></span>
										{/if}
										Test
									</button>
								</form>
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="section" id="calendars">Calendars</h2>

	{#if data.calendars.length === 0}
		<p class="empty">No calendars are configured in when.yaml.</p>
	{:else}
		<ul class="list">
			{#each data.calendars as calendar (calendar.name)}
				<li class="card">
					{@render notice(
						`calendar:${calendar.name}`,
						'calendar',
						calendar.health === 'bad' ? (calendar.reason ?? 'not syncing') : null
					)}

					<div class="body">
						<h2 class="name">{calendar.name}</h2>

						<dl class="fields">
							<dt>Type</dt>
							<dd>{calendar.type}</dd>

							<dt>Provider</dt>
							<dd>{calendar.provider}</dd>

							<dt>Status</dt>
							{#if calendar.health === 'bad'}
								<dd class="failed">down</dd>
							{:else if calendar.health === 'good'}
								<dd class="ok">up ({timeAgo(calendar.lastSyncedAt)})</dd>
							{:else}
								<dd>not observed</dd>
							{/if}

							<dt>Refreshes</dt>
							<dd>every {calendar.refreshEveryMinutes} min</dd>

							<dt>{calendar.target.label}</dt>
							<dd><code>{calendar.target.value}</code></dd>
						</dl>
					</div>

					<div class="actions">
						<div class="actions-change"></div>
						<div class="actions-check">
							<form
								method="POST"
								action="?/testCalendar"
								use:enhance={run(`test:calendar:${calendar.name}`)}
							>
								<input type="hidden" name="calendar" value={calendar.name} />
								<button
									type="submit"
									class="button"
									disabled={pending === `test:calendar:${calendar.name}`}
								>
									{#if pending === `test:calendar:${calendar.name}`}
										<span class="spinner"><IconSpinner aria-hidden="true" /></span>
									{/if}
									Test
								</button>
							</form>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="section" id="worker">Worker</h2>

	<div class="card">
		{@render notice('worker', 'worker')}

		<div class="body">
			<h3 class="name">{data.worker.url}</h3>
			<p class="worker-note">Runs calendar refreshes, appointment pushes and email.</p>
		</div>

		<div class="actions">
			<form method="POST" action="?/worker" class="worker-form" use:enhance={run('worker')}>
				<button type="submit" class="button" disabled={pending === 'worker'}>
					{#if pending === 'worker'}
						<span class="spinner"><IconSpinner aria-hidden="true" /></span>
					{/if}
					Test
				</button>
			</form>
		</div>
	</div>

	<h2 class="section" id="email">Email</h2>

	<div class="card">
		{@render notice(
			'smtp',
			'smtp',
			data.smtp.observed.state === 'failing' ? data.smtp.observed.error : null
		)}

		<div class="body">
			<h3 class="name">{data.smtp.host}</h3>

			<dl class="fields">
				<dt>Status</dt>
				{#if data.smtp.observed.state === 'failing'}
					<dd class="failed">down ({timeAgo(data.smtp.observed.at)})</dd>
				{:else if data.smtp.observed.state === 'working'}
					<dd class="ok">up ({timeAgo(data.smtp.observed.at)})</dd>
				{:else}
					<dd>not observed</dd>
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
			<form method="POST" action="?/email" class="email-form" use:enhance={run('smtp')}>
				<label class="email-label" for="test-recipient">Send a test email to</label>
				<input
					id="test-recipient"
					class="email-input"
					type="email"
					name="to"
					value={data.smtp.defaultRecipient}
					required
				/>
				<button type="submit" class="button" disabled={pending === 'smtp'}>
					{#if pending === 'smtp'}
						<span class="spinner"><IconSpinner aria-hidden="true" /></span>
					{/if}
					Send
				</button>
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
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-4) var(--space-5);
		border: 0;
		border-bottom: 1px solid;
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
		scroll-margin-top: var(--space-6);
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

	.worker-form {
		display: flex;
		justify-content: flex-end;
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

	.worker-note {
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
