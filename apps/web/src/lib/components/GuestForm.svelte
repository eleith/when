<!-- Step 3: the guest fills in their details. Owns all guest-field state and posts the booking. -->
<script lang="ts">
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import { formatDateCompact, formatTimeShort, formatTzAbbrev } from '$lib/datetime';
	import { evaluateVisibility } from '$lib/forms/conditional';
	import FormFieldControl from '$lib/components/FormFieldControl.svelte';
	import type { AppointmentFlow } from '$lib/appointmentFlow.svelte';
	import type { GuestAnswer, FormField } from '@when/config';
	import type { PublicEventType } from '$lib/server/appointment/sanitize';

	interface RescheduleAppt {
		id: string;
		guest_name: string;
		guest_email: string | null;
		answers: GuestAnswer[];
		location: string | null;
	}

	interface Props {
		flow: AppointmentFlow;
		formFields: readonly FormField[];
		rescheduleAppt: RescheduleAppt | null;
		rescheduleToken: string | null;
		fieldsDisabled: boolean;
		form: { error?: string; fieldErrors?: Record<string, string> } | null;
		formAction: string;
		bookingApproval: PublicEventType['booking_approval'];
	}

	let {
		flow,
		formFields,
		rescheduleAppt,
		rescheduleToken,
		fieldsDisabled,
		form,
		formAction,
		bookingApproval
	}: Props = $props();

	// read-only views of the shared flow; the back button goes through flow.goBack
	let selectedSlot = $derived(flow.selectedSlot);
	let viewDate = $derived(flow.viewDate);
	let userTz = $derived(flow.userTz);

	// svelte-ignore state_referenced_locally
	const priorAnswers = rescheduleAppt?.answers ?? [];

	function initialFieldValue(field: FormField): string {
		if (!rescheduleAppt) return '';
		if (field.type === 'guest_name') return rescheduleAppt.guest_name ?? '';
		if (field.type === 'guest_email') return rescheduleAppt.guest_email ?? '';
		if (field.type === 'event_location') return rescheduleAppt.location ?? '';
		return priorAnswers.find((a) => a.name === field.name)?.value ?? '';
	}

	// svelte-ignore state_referenced_locally
	let fieldValues = $state<Record<string, string>>(
		Object.fromEntries(formFields.map((f) => [f.name, initialFieldValue(f)]))
	);

	const visibleFields = $derived(evaluateVisibility(formFields, (name) => fieldValues[name] ?? ''));

	function trackFieldValue(event: Event) {
		const target = event.target as
			| HTMLInputElement
			| HTMLSelectElement
			| HTMLTextAreaElement
			| null;
		if (target?.name) fieldValues[target.name] = target.value;
	}

	let rescheduleReasonValue = $state('');
	let rescheduleReasonEl = $state<HTMLTextAreaElement | null>(null);

	// The name field self-focuses via FormFieldControl; in the admin reschedule case
	// there is no editable name field, so focus the reason box instead.
	$effect(() => {
		if (fieldsDisabled) rescheduleReasonEl?.focus();
	});
</script>

<div class="form-header">
	<button type="button" class="form-back" onclick={flow.goBack} aria-label="Back to time picker">
		<IconCaretLeft aria-hidden="true" />
	</button>
	<h2 class="form-title">
		{#if selectedSlot}
			{#if viewDate}{formatDateCompact(viewDate)} at&nbsp;{/if}{formatTimeShort(
				selectedSlot,
				userTz
			)}
			<span class="form-title-tz">{formatTzAbbrev(selectedSlot, userTz)}</span>
		{/if}
	</h2>
</div>
<div class="appointment-form">
	{#if form?.error}
		<p class="form-error" role="alert">{form.error}</p>
	{/if}

	<form
		id="appointment-form"
		method="POST"
		action={formAction}
		oninput={trackFieldValue}
		onchange={trackFieldValue}
	>
		<input type="hidden" name="slot" value={selectedSlot} />
		<input type="hidden" name="timezone" value={userTz} />
		<input type="hidden" name="duration" value={flow.duration} />
		{#if rescheduleAppt}
			<input type="hidden" name="reschedule" value={rescheduleAppt.id} />
			<input type="hidden" name="token" value={rescheduleToken} />
		{/if}

		{#each formFields as field (field.name)}
			{#if visibleFields.get(field.name)}
				<FormFieldControl
					{field}
					value={initialFieldValue(field)}
					liveValue={fieldValues[field.name] ?? ''}
					disabled={fieldsDisabled}
					error={form?.fieldErrors?.[field.name]}
					focusOnMount={field.type === 'guest_name' && !fieldsDisabled}
				/>
			{/if}
		{/each}

		{#if rescheduleAppt}
			<div class="field-separator-container">
				<hr class="wizard-separator" />
			</div>
			<div class="field">
				<label for="reschedule_reason"> Reason for rescheduling </label>
				<textarea
					id="reschedule_reason"
					name="reschedule_reason"
					rows="3"
					maxlength="500"
					placeholder="e.g. scheduling conflict, double booked..."
					required
					bind:value={rescheduleReasonValue}
					bind:this={rescheduleReasonEl}
				></textarea>
				<span class="field-count">{(rescheduleReasonValue ?? '').length}/500</span>
			</div>
		{/if}

		<button type="submit" class="submit-btn">
			{#if rescheduleAppt}Confirm Reschedule{:else if bookingApproval === 'request'}Request{:else}Schedule{/if}
		</button>
	</form>
</div>

<style>
	.appointment-form {
		width: 100%;
	}

	.form-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-7);
		min-width: 0;
	}

	.form-title {
		font-size: var(--font-size-lg);
		font-weight: 600;
		margin: 0;
	}

	.form-title-tz {
		font-size: var(--font-size-md);
		font-weight: 400;
		color: var(--color-text-muted);
	}

	/* caret to return to the time picker — mobile only (desktop has the wizard back button) */
	.form-back {
		display: none;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		background: none;
		border: none;
		padding: var(--space-1);
		margin-left: calc(var(--space-2) * -1);
		font-size: var(--font-size-xl);
		line-height: 1;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color var(--transition);
	}

	.form-back:hover {
		color: var(--when-color-text);
	}

	.form-error {
		background: var(--color-danger-bg);
		color: var(--color-danger);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		font-size: var(--font-size-base);
		margin-bottom: var(--space-6);
	}

	.field {
		margin-bottom: var(--space-5);
	}

	.field label {
		display: block;
		font-size: var(--font-size-sm);
		font-weight: 600;
		margin-bottom: var(--space-2);
		color: var(--color-text-secondary);
	}

	.field textarea {
		width: 100%;
		padding: var(--space-4) var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		box-sizing: border-box;
		transition: border-color var(--transition);
		background: var(--color-surface);
		color: var(--when-color-text);
	}

	.field textarea:focus {
		outline: none;
		border-color: var(--when-color-primary);
		box-shadow: var(--shadow-focus);
	}

	.field-count {
		display: block;
		margin-top: var(--space-1);
		text-align: right;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	/* Hidden control so pressing Enter in a field submits; the visible submit is the wizard CTA. */
	.submit-btn {
		display: none;
	}

	.field-separator-container {
		margin: var(--space-6) 0 var(--space-6);
	}

	.wizard-separator {
		border: 0;
		border-top: 1px dashed var(--color-border-strong);
		margin: 0;
	}

	textarea:disabled {
		background: var(--color-surface-muted);
		border-color: var(--color-border);
		color: var(--color-text-muted);
		cursor: not-allowed;
		opacity: 0.7;
	}

	@media (max-width: 768px) {
		.form-back {
			display: inline-flex;
		}
	}
</style>
