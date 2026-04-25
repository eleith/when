<script lang="ts">
	let { data } = $props();

	function fmtTime(iso: string): string {
		return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function fmtDate(iso: string): string {
		return new Date(iso + 'T00:00:00').toLocaleDateString([], {
			weekday: 'long',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>{data.eventType.name} — {data.user.name}</title>
</svelte:head>

<header>
	<h1>{data.eventType.name}</h1>
	<p>{data.eventType.duration} minutes with {data.user.name}</p>
	{#if data.eventType.description}
		<p>{data.eventType.description}</p>
	{/if}
</header>

{#if Object.keys(data.slotsByDate).length === 0}
	<p>No availability in the next {data.eventType.duration} days.</p>
{:else}
	{#each Object.entries(data.slotsByDate) as [date, slots] (date)}
		<section>
			<h2>{fmtDate(date)}</h2>
			<ul>
				{#each slots as iso (iso)}
					<li>{fmtTime(iso)}</li>
				{/each}
			</ul>
		</section>
	{/each}
{/if}
