<script lang="ts">
	let { data } = $props();

	let title = $derived(
		data.appointment.status === 'cancelled'
			? 'Booking cancelled'
			: data.appointment.status === 'pending'
				? 'Booking requested'
				: 'Booking confirmed'
	);

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
	<title>{title} — When</title>
</svelte:head>

{#if data.appointment.status === 'cancelled'}
	<h1>Booking cancelled</h1>
	<p>This booking was previously cancelled.</p>
{:else if data.appointment.status === 'pending'}
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
	<dd>{fmt(data.appointment.start_time)} &rarr; {fmt(data.appointment.end_time)}</dd>

	{#if data.appointment.location}
		<dt>Where</dt>
		<dd>{data.appointment.location}</dd>
	{/if}

	<dt>Attendee</dt>
	<dd>{data.appointment.attendee_name} &lt;{data.appointment.attendee_email}&gt;</dd>
</dl>

<p>
	<a
		href="/booked/{data.appointment.id}/ics?token={encodeURIComponent(data.token)}"
		download="when-{data.appointment.id}.ics">Download .ics</a
	>
</p>

{#if data.appointment.status === 'pending' || data.appointment.status === 'confirmed'}
	<p>
		<a
			href="/schedule/{data.eventType.slug}?reschedule={data.appointment
				.id}&token={encodeURIComponent(data.token)}">Reschedule</a
		>
	</p>
	<form method="POST" action="?/cancel" class="cancel-form">
		<input type="hidden" name="token" value={data.token} />
		<button type="submit" class="cancel-btn">Cancel booking</button>
	</form>
{/if}

<style>
	.cancel-form {
		margin-top: 24px;
	}

	.cancel-btn {
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		padding: 8px 16px;
		color: var(--danger);
		cursor: pointer;
		font-size: 0.875rem;
		font-family: inherit;
	}

	.cancel-btn:hover {
		background: var(--danger-bg);
		border-color: var(--danger-border);
	}
</style>
