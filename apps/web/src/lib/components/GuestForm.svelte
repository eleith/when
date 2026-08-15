<!-- Step 3: the guest fills in their details. Owns all guest-field state and posts the booking. -->
<script lang="ts">
	import { enhance } from '$app/forms';
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import { formatDateCompact, formatTimeShort, formatTzAbbrev } from '$lib/datetime';
	import { evaluateVisibility } from '$lib/forms/conditional';
	import { defaultFieldValue } from '$lib/forms/defaults';
	import FormFieldControl from '$lib/components/FormFieldControl.svelte';
	import { validateFieldValue } from '$lib/forms/validation.js';
	import type { AppointmentFlow } from '$lib/appointmentFlow.svelte';
	import type { GuestAnswer, FormField } from '@when/config';
	import type { PublicEventType } from '$lib/server/appointment/sanitize';

	const RESCHEDULE_FIELD: FormField = {
		name: 'reschedule_reason',
		label: 'Reason for rescheduling',
		type: 'paragraph',
		required: true
	};

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
		requireApproval: PublicEventType['require_approval'];
		onvaliditychange?: (valid: boolean) => void;
	}

	let {
		flow,
		formFields,
		rescheduleAppt,
		rescheduleToken,
		fieldsDisabled,
		form,
		formAction,
		requireApproval,
		onvaliditychange
	}: Props = $props();

	// read-only views of the shared flow; the back button goes through flow.goBack
	let selectedSlot = $derived(flow.selectedSlot);
	let viewDate = $derived(flow.viewDate);
	let userTz = $derived(flow.userTz);

	// svelte-ignore state_referenced_locally
	const priorAnswers = rescheduleAppt?.answers ?? [];

	function priorFieldValue(field: FormField): string {
		if (!rescheduleAppt) return '';
		if (field.type === 'guest_name') return rescheduleAppt.guest_name ?? '';
		if (field.type === 'guest_email') return rescheduleAppt.guest_email ?? '';
		if (field.type === 'event_location') return rescheduleAppt.location ?? '';
		return priorAnswers.find((a) => a.name === field.name)?.value ?? '';
	}

	function initialFieldValue(field: FormField): string {
		return priorFieldValue(field) || defaultFieldValue(field);
	}

	// svelte-ignore state_referenced_locally
	let fieldValues = $state<Record<string, string>>(
		Object.fromEntries(formFields.map((f) => [f.name, initialFieldValue(f)]))
	);
	let rescheduleReasonValue = $state('');

	const visibleFields = $derived(evaluateVisibility(formFields, (name) => fieldValues[name] ?? ''));

	let isFormValid = $derived.by(() => {
		if (rescheduleAppt && validateFieldValue(RESCHEDULE_FIELD, rescheduleReasonValue)) {
			return false;
		}
		if (fieldsDisabled) {
			return true;
		}
		for (const field of formFields) {
			if (!visibleFields.get(field.name)) continue;
			const val = fieldValues[field.name] ?? '';
			if (validateFieldValue(field, val)) return false;
		}
		return true;
	});

	$effect(() => {
		onvaliditychange?.(isFormValid);
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

	<form id="appointment-form" method="POST" action={formAction} use:enhance>
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
					bind:value={fieldValues[field.name]}
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
			<FormFieldControl
				field={RESCHEDULE_FIELD}
				bind:value={rescheduleReasonValue}
				error={form?.fieldErrors?.reschedule_reason}
				focusOnMount={fieldsDisabled}
				placeholder="e.g. scheduling conflict, double booked..."
			/>
		{/if}

		<button type="submit" class="submit-btn" disabled={!isFormValid}>
			{#if rescheduleAppt}Confirm Reschedule{:else if requireApproval}Request{:else}Schedule{/if}
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

	@media (max-width: 768px) {
		.form-back {
			display: inline-flex;
		}
	}
</style>
