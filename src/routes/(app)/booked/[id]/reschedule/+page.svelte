<script lang="ts">
	import SlotPicker from '$lib/components/SlotPicker.svelte';

	let { data, form } = $props();

	let userTz = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);
	let viewSlot = $state<string | null>(null);
	let viewDate = $state<string | null>(null);

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
	<title>Reschedule booking — When</title>
</svelte:head>

{#if data.kind === 'error'}
	<h1>Can't reschedule this booking</h1>
	<p class="reason">
		{#if data.code === 'token'}
			This link doesn't match a booking. Check your email for the latest reschedule link.
		{:else if data.code === 'event_type'}
			This booking's event type no longer exists.
		{:else if data.code === 'past_window'}
			This booking is too old to reschedule.
		{:else if data.code === 'terminal'}
			This booking has already been cancelled or declined.
		{:else if data.code === 'minimum_notice'}
			It's too close to the start time to reschedule.
		{/if}
	</p>
	{#if data.eventSlug}
		<p>
			<a href="/schedule/{data.eventSlug}">Pick another time</a>
		</p>
	{/if}
{:else}
	<h1>Reschedule</h1>
	<p class="moving-from">Moving from <strong>{fmt(data.appointment.start_time)}</strong></p>
	<p class="attendee">
		Rescheduling for {data.appointment.attendee_name}
		&lt;{data.appointment.attendee_email}&gt;
	</p>

	<SlotPicker
		slotsByDate={data.slotsByDate}
		workingWindows={data.workingWindows}
		busyBlocks={data.busyBlocks}
		eventType={data.eventType}
		bind:selectedSlot={viewSlot}
		bind:viewDate
		bind:userTz
	/>

	{#if form?.error}
		<p class="form-error" role="alert">{form.error}</p>
	{/if}

	<form method="POST" class="submit-row">
		<input type="hidden" name="token" value={data.token} />
		<input type="hidden" name="slot" value={viewSlot ?? ''} />
		<button type="submit" class="submit-btn" disabled={!viewSlot}>Reschedule</button>
		<a
			href="/booked/{data.appointment.id}?token={encodeURIComponent(data.token)}"
			class="cancel-link">Keep current time</a
		>
	</form>
{/if}

<style>
	.reason {
		color: var(--text-muted);
		margin: var(--space-3) 0 var(--space-5);
	}

	.moving-from {
		color: var(--text-secondary);
		margin: var(--space-3) 0 var(--space-2);
	}

	.attendee {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		margin: 0 0 var(--space-6);
	}

	.form-error {
		background: var(--danger-bg);
		color: var(--danger);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		font-size: var(--font-size-base);
		margin-top: var(--space-5);
	}

	.submit-row {
		display: flex;
		gap: var(--space-4);
		align-items: center;
		margin-top: var(--space-6);
	}

	.submit-btn {
		background: var(--primary);
		color: var(--text-on-primary);
		border: none;
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-6);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
	}

	.submit-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.cancel-link {
		color: var(--text-muted);
	}
</style>
