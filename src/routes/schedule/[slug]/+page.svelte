<script lang="ts">
	let { data, form } = $props();

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

{#if data.selectedSlot}
	{@const slot = data.selectedSlot}
	<section class="booking">
		<h2>Confirm {fmtTime(slot)}</h2>
		<p><a href="?">Pick a different time</a></p>

		{#if form?.error}
			<p class="error" role="alert">{form.error}</p>
		{/if}

		<form method="POST" action="?/book">
			<input type="hidden" name="slot" value={slot} />

			<label>
				Name
				<input name="name" required autocomplete="name" />
			</label>

			<label>
				Email
				<input name="email" type="email" required autocomplete="email" />
			</label>

			{#if data.eventType.location?.mode === 'fixed'}
				<p>Location: {data.eventType.location.fixed}</p>
			{:else if data.eventType.location?.mode === 'guest_proposes'}
				<label>
					Meeting location
					<input name="location" required />
				</label>
			{:else if data.eventType.location?.mode === 'choice'}
				<label>
					Meeting location
					<select name="location" required>
						{#each data.eventType.location.choices as c (c)}
							<option value={c}>{c}</option>
						{/each}
					</select>
				</label>
			{/if}

			<label>
				Notes (optional)
				<textarea name="notes" rows="3"></textarea>
			</label>

			<button type="submit">Book</button>
		</form>
	</section>
{:else if Object.keys(data.slotsByDate).length === 0}
	<p>No availability in the next {data.eventType.duration} days.</p>
{:else}
	{#each Object.entries(data.slotsByDate) as [date, slots] (date)}
		<section>
			<h2>{fmtDate(date)}</h2>
			<ul>
				{#each slots as iso (iso)}
					<li><a href="?slot={encodeURIComponent(iso)}">{fmtTime(iso)}</a></li>
				{/each}
			</ul>
		</section>
	{/each}
{/if}

<style>
	.error {
		color: #b00020;
	}
</style>
