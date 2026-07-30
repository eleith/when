<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Google Authorization — When</title>
</svelte:head>

<section class="callback">
	{#if data.error}
		<h1 class="title">Could not connect</h1>
		{#if data.service}
			<p class="lede">{data.service} was not connected.</p>
		{/if}
		<p class="reason">{data.error}</p>
	{:else}
		<h1 class="title">Connected</h1>
		<p class="lede">
			{data.service} is authorized. Calendar sync picks it up on the next pass.
		</p>
	{/if}

	<a class="back" href="/admin/services">Back to services</a>
</section>

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

	.back {
		font-size: var(--font-size-base);
		color: var(--color-text-secondary);
	}
</style>
