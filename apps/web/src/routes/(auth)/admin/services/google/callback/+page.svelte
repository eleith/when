<script lang="ts">
	import AdminPage from '$lib/components/AdminPage.svelte';

	let { data } = $props();

	let envBlock = $state<HTMLElement | null>(null);
	let yamlBlock = $state<HTMLElement | null>(null);
	let copied = $state<'env' | 'yaml' | null>(null);
	let copyTimeout: ReturnType<typeof setTimeout>;

	async function copy(which: 'env' | 'yaml', el: HTMLElement | null) {
		if (!el?.textContent) return;
		try {
			await navigator.clipboard?.writeText(el.textContent);
			copied = which;
		} catch {
			return;
		}
		clearTimeout(copyTimeout);
		copyTimeout = setTimeout(() => (copied = null), 2000);
	}
</script>

<svelte:head>
	<title>Google Authorization — When</title>
</svelte:head>

<AdminPage>
	{#snippet crumb()}Google authorization{/snippet}

	<section class="callback">
		{#if data.error}
			<h1 class="title">Could not connect</h1>
			{#if data.service}
				<p class="lede">{data.service} was not connected.</p>
			{/if}
			<p class="reason">{data.error}</p>
		{:else}
			<h1 class="title">Authorized</h1>
			<p class="lede">
				Google issued a refresh token for {data.service}. When keeps every secret in your
				environment, not its database, so save it yourself in the steps below.
			</p>
			<p class="warning">
				This token is shown once. Leaving this page loses it, and you would have to authorize again.
			</p>

			<ol class="steps">
				<li>
					<h2 class="step-title">Add it to your <code>.env</code></h2>
					<div class="snippet">
						<pre bind:this={envBlock}>{data.envVar}={data.refreshToken}</pre>
						<button type="button" class="copy" onclick={() => copy('env', envBlock)}>
							{#if copied === 'env'}Copied{:else}Copy{/if}
						</button>
					</div>
				</li>

				<li>
					<h2 class="step-title">Reference it from <code>when.yaml</code></h2>
					<p class="step-note">Skip this if the provider already has a refresh_token line.</p>
					<div class="snippet">
						<pre bind:this={yamlBlock}>providers:
  {data.service}:
    refresh_token: '&#36;&lbrace;{data.envVar}&rbrace;'</pre>
						<button type="button" class="copy" onclick={() => copy('yaml', yamlBlock)}>
							{#if copied === 'yaml'}Copied{:else}Copy{/if}
						</button>
					</div>
				</li>

				<li>
					<h2 class="step-title">Recreate the containers</h2>
					<div class="snippet">
						<pre>docker compose up -d</pre>
					</div>
					<p class="step-note">
						It has to be <code>up -d</code>, not <code>restart</code>. Compose reads
						<code>.env</code> when it creates a container, so restarting the one you have keeps the old
						environment.
					</p>
				</li>
			</ol>
		{/if}

		<a class="back" href="/admin/health">Back to health</a>
	</section>
</AdminPage>

<style>
	.callback {
		padding: var(--space-8) 0;
		max-width: 42rem;
	}

	.title {
		margin: 0 0 var(--space-4);
		font-size: var(--font-size-2xl);
		color: var(--when-color-text);
	}

	.lede {
		margin: 0 0 var(--space-5);
		font-size: var(--font-size-md);
		color: var(--color-text-secondary);
	}

	.reason {
		margin: 0 0 var(--space-5);
		padding: var(--space-4) var(--space-5);
		background: var(--color-danger-bg);
		border: 1px solid var(--color-danger-border);
		border-radius: var(--radius);
		font-size: var(--font-size-sm);
		color: var(--color-danger-strong);
		overflow-wrap: anywhere;
	}

	.warning {
		margin: 0 0 var(--space-6);
		padding: var(--space-4) var(--space-5);
		background: var(--color-warning-bg);
		border: 1px solid var(--color-warning-border);
		border-radius: var(--radius);
		font-size: var(--font-size-sm);
		color: var(--color-warning-strong);
	}

	.steps {
		margin: 0 0 var(--space-6);
		padding-left: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.step-title {
		margin: 0 0 var(--space-3);
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--when-color-text);
	}

	.step-note {
		margin: var(--space-3) 0 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	.snippet {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}

	.snippet pre {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-muted);
		border-radius: var(--radius);
		font-size: var(--font-size-sm);
		overflow-x: auto;
		user-select: all;
	}

	.copy {
		flex: none;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: transparent;
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.copy:hover {
		color: var(--when-color-text);
	}

	.back {
		font-size: var(--font-size-base);
		color: var(--color-text-secondary);
	}
</style>
