<script lang="ts">
	let { data, form } = $props();

	let resultAction = $derived(form?.done ? form.action : null);
	let title = $derived(
		resultAction === 'accept'
			? 'Accepted — When'
			: resultAction === 'decline'
				? 'Declined — When'
				: data.already
					? `Already ${data.already} — When`
					: 'Confirm response — When'
	);
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

{#if form?.done}
	{#if form.alreadyDecided}
		<h1>Already {form.already}</h1>
		<p>This booking has already been {form.already}.</p>
	{:else if form.action === 'accept'}
		<h1>Booking accepted</h1>
		<p>{form.attendee.name} has been confirmed for {form.eventTypeName}.</p>
	{:else}
		<h1>Booking declined</h1>
		<p>{form.attendee.name} was declined for {form.eventTypeName}.</p>
	{/if}
{:else if data.already}
	<h1>Already {data.already}</h1>
	<p>This booking has already been {data.already}.</p>
{:else}
	<h1>
		{data.action === 'accept' ? 'Accept this booking?' : 'Decline this booking?'}
	</h1>
	<p>
		{data.attendee.name} &lt;{data.attendee.email}&gt; — {data.eventTypeName}
	</p>
	<form method="POST">
		<input type="hidden" name="action" value={data.action} />
		<input type="hidden" name="token" value={data.token} />
		<button type="submit" class="confirm-btn confirm-{data.action}">
			Confirm {data.action}
		</button>
	</form>
{/if}

<p><a href="/admin">Back to admin</a></p>

<style>
	h1 {
		margin: 0 0 var(--space-3);
	}

	p {
		margin: 0 0 var(--space-5);
		color: var(--text-muted);
	}

	a {
		color: var(--accent);
	}

	.confirm-btn {
		font-size: var(--font-size-md);
		font-weight: 600;
		padding: var(--space-3) var(--space-5);
		border-radius: var(--radius);
		border: 1px solid transparent;
		cursor: pointer;
	}

	.confirm-accept {
		background: var(--success);
		color: var(--text-on-accent);
	}

	.confirm-accept:hover {
		background: var(--success-strong);
	}

	.confirm-decline {
		background: var(--danger);
		color: var(--text-on-accent);
	}

	.confirm-decline:hover {
		background: var(--danger-strong);
	}
</style>
