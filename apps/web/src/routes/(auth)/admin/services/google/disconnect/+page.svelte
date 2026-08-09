<script lang="ts">
	import AdminPage from '$lib/components/AdminPage.svelte';

	let { form } = $props();
</script>

<svelte:head>
	<title>Disconnect Google — When</title>
</svelte:head>

<AdminPage>
	{#snippet crumb()}Disconnect google{/snippet}

	<section class="disconnect">
		{#if !form}
			<h1 class="title">Nothing to disconnect</h1>
			<p class="lede">Start a disconnect from the health page.</p>
		{:else}
			{#if form.revoked}
				<h1 class="title">Revoked</h1>
				<p class="lede">
					The grant for {form.service} is ended at Google. The token in your environment is dead, but
					still present — remove it to finish.
				</p>
			{:else}
				<h1 class="title">Could not revoke</h1>
				<p class="lede">
					Google would not confirm the revoke for {form.service}, so treat the token as live. Remove
					it from your environment, then revoke the app at
					<a href="https://myaccount.google.com/permissions">your Google account</a>.
				</p>
				<p class="reason">{form.reason}</p>
			{/if}

			<ol class="steps">
				<li>
					<h2 class="step-title">Clear it from your <code>.env</code></h2>
					<div class="snippet">
						<pre>{form.envVar}=</pre>
					</div>
					<p class="step-note">
						Emptying the value is enough — the provider reads as not connected. You can delete the
						line instead, but only if <code>when.yaml</code> uses the
						<code>:-</code> fallback form.
					</p>
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
	.disconnect {
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

	.back {
		font-size: var(--font-size-base);
		color: var(--color-text-secondary);
	}
</style>
