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
	<title>Cancel booking — When</title>
</svelte:head>

<h1>Cancel this booking?</h1>
<p>
	This will cancel the booking with <strong>{data.appointment.attendee_name}</strong> and notify both
	of you.
</p>

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
</dl>

<form method="POST" class="actions">
	<input type="hidden" name="token" value={data.token} />
	<button type="submit" class="cancel-btn">Cancel booking</button>
	<a href="/booked/{data.appointment.id}?token={encodeURIComponent(data.token)}" class="keep-link"
		>Keep booking</a
	>
</form>

<style>
	.when-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	:global(.when-arrow) {
		color: var(--text-muted);
	}

	.actions {
		display: flex;
		gap: var(--space-4);
		align-items: center;
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

	.keep-link {
		color: var(--text-muted);
	}
</style>
