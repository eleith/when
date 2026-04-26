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
		margin: 0 0 8px;
	}

	p {
		margin: 0 0 16px;
		color: #6b7280;
	}

	a {
		color: var(--accent, #4f46e5);
	}

	.confirm-btn {
		font-size: 0.9375rem;
		font-weight: 600;
		padding: 8px 16px;
		border-radius: 8px;
		border: 1px solid transparent;
		cursor: pointer;
		font-family: inherit;
	}

	.confirm-accept {
		background: #059669;
		color: white;
	}

	.confirm-accept:hover {
		background: #047857;
	}

	.confirm-decline {
		background: #dc2626;
		color: white;
	}

	.confirm-decline:hover {
		background: #b91c1c;
	}
</style>
