<script lang="ts">
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	let { data } = $props();

	let title = $derived(titleFor(data.appointment.status));

	function titleFor(status: string): string {
		if (status === 'cancelled') return 'Booking cancelled';
		if (status === 'declined') return 'Booking declined';
		if (status === 'pending') return 'Booking requested';
		return 'Booking confirmed';
	}

	function clockStatusLabel(s: 'upcoming' | 'in_progress' | 'concluded'): string {
		if (s === 'upcoming') return 'Upcoming';
		if (s === 'in_progress') return 'In progress';
		return 'Concluded';
	}

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
	<p class="clock-status">{clockStatusLabel(data.clockStatus)}</p>
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

<p>
	<a
		href="/booked/{data.appointment.id}/ics?token={encodeURIComponent(data.token)}"
		download="when-{data.appointment.id}.ics">Download .ics</a
	>
</p>

{#if data.actions.reschedule.allowed}
	<p>
		<a
			href="/schedule/{data.eventType.slug}?reschedule={data.appointment
				.id}&token={encodeURIComponent(data.token)}">Reschedule</a
		>
	</p>
{/if}
{#if data.actions.cancel.allowed}
	<form method="POST" action="?/cancel" class="cancel-form">
		<input type="hidden" name="token" value={data.token} />
		<button type="submit" class="cancel-btn">Cancel booking</button>
	</form>
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

	.cancel-form {
		margin-top: var(--space-7);
	}

	.cancel-btn {
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-5);
		color: var(--danger);
		cursor: pointer;
		font-size: var(--font-size-base);
	}

	.cancel-btn:hover {
		background: var(--danger-bg);
		border-color: var(--danger-border);
	}
</style>
