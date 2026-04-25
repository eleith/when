<script lang="ts">
	let { data } = $props();

	let title = $derived(
		(data.action === 'accept' ? 'Accepted' : data.action === 'decline' ? 'Declined' : 'Response') +
			' — When'
	);
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

{#if data.already}
	<h1>Already {data.already}</h1>
	<p>This booking has already been {data.already}.</p>
{:else}
	<h1>
		{#if data.action === 'accept'}
			Booking accepted
		{:else}
			Booking declined
		{/if}
	</h1>
	<p>
		{data.attendee?.name ?? 'The attendee'}
		{#if data.action === 'accept'}
			has been confirmed for {data.eventTypeName}.
		{:else}
			was declined for {data.eventTypeName}.
		{/if}
	</p>
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
		color: #4f46e5;
	}
</style>
