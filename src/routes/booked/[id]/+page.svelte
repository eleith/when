<script lang="ts">
	let { data } = $props();

	function fmt(iso: string): string {
		return new Date(iso).toLocaleString([], {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Booking confirmed — When</title>
</svelte:head>

{#if data.appointment.status === 'pending'}
	<h1>Booking requested</h1>
	<p>
		{data.user.name} will review and confirm your request. You'll get an email at
		<strong>{data.appointment.attendee_email}</strong> with the outcome.
	</p>
{:else}
	<h1>You're booked</h1>
{/if}

<dl>
	<dt>Event</dt>
	<dd>{data.eventType.name}</dd>

	<dt>When</dt>
	<dd>{fmt(data.appointment.start_time)} → {fmt(data.appointment.end_time)}</dd>

	{#if data.appointment.location}
		<dt>Where</dt>
		<dd>{data.appointment.location}</dd>
	{/if}

	<dt>Attendee</dt>
	<dd>{data.appointment.attendee_name} &lt;{data.appointment.attendee_email}&gt;</dd>
</dl>
