<script lang="ts">
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
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
	{#if data.appointment.status === 'cancelled'}
		<title>Booking cancelled — When</title>
	{:else if data.appointment.status === 'declined'}
		<title>Booking declined — When</title>
	{:else if data.appointment.status === 'pending'}
		<title>Booking requested — When</title>
	{:else}
		<title>Booking confirmed — When</title>
	{/if}
</svelte:head>

{#if data.appointment.status === 'cancelled'}
	<h1>Booking cancelled</h1>
	<p>This booking was previously cancelled.</p>
{:else if data.appointment.status === 'declined'}
	<h1>Booking declined</h1>
	<p>
		{data.user.name} declined this request.
		<a href="/schedule/{data.eventType.slug}">Pick another time</a>.
	</p>
{:else if data.appointment.status === 'pending'}
	<h1>Booking requested</h1>
	<p>
		{data.user.name} will review and confirm your request. You'll get an email at
		<strong>{data.appointment.attendee_email}</strong> with the outcome.
	</p>
{:else}
	<h1>You're booked</h1>
{/if}

{#if data.clockStatus}
	<p class="clock-status">
		{#if data.clockStatus === 'upcoming'}Upcoming
		{:else if data.clockStatus === 'in_progress'}In progress
		{:else}Concluded
		{/if}
	</p>
{/if}

<dl>
	<dt>Event</dt>
	<dd>{data.eventType.name}</dd>

	<dt>When</dt>
	<dd class="when-row">
		{fmt(data.appointment.start_time)}
		<IconArrowRight class="when-arrow" aria-hidden="true" />
		{fmt(data.appointment.end_time)}
	</dd>

	{#if data.appointment.location}
		<dt>Where</dt>
		<dd>{data.appointment.location}</dd>
	{/if}

	<dt>Attendee</dt>
	<dd>{data.appointment.attendee_name} &lt;{data.appointment.attendee_email}&gt;</dd>
</dl>

{#if data.appointment.status === 'confirmed'}
	<p>
		<a
			href="/booked/{data.appointment.id}/ics?token={encodeURIComponent(data.token)}"
			download="when-{data.appointment.id}.ics">Download .ics</a
		>
	</p>
{/if}

{#if data.actions.reschedule.allowed}
	<p>
		<a href="/booked/{data.appointment.id}/reschedule?token={encodeURIComponent(data.token)}"
			>Reschedule</a
		>
	</p>
{/if}
{#if data.actions.cancel.allowed}
	<p class="cancel-link-row">
		<a
			href="/booked/{data.appointment.id}/cancel?token={encodeURIComponent(data.token)}"
			class="cancel-link">Cancel booking</a
		>
	</p>
{/if}

<style>
	.when-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	:global(.when-arrow) {
		color: var(--text-muted);
	}

	.clock-status {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin-top: var(--space-2);
	}

	.cancel-link-row {
		margin-top: var(--space-7);
	}

	.cancel-link {
		color: var(--danger);
	}

	.cancel-link:hover {
		color: var(--danger-strong);
	}
</style>
