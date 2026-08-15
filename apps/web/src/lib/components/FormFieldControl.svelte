<!-- One labelled guest-input, rendered per configured form field type. -->
<script lang="ts">
	import type { FormField } from '@when/config';
	import { PHONE_PATTERN, validateFieldValue } from '$lib/forms/validation.js';

	interface Props {
		field: FormField;
		value: string;
		liveValue?: string;
		disabled?: boolean;
		error?: string;
		focusOnMount?: boolean;
	}

	let {
		field,
		value,
		liveValue = '',
		disabled = false,
		error,
		focusOnMount = false
	}: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let touched = $state(false);

	$effect(() => {
		if (focusOnMount) container?.querySelector<HTMLElement>('input, select, textarea')?.focus();
	});

	let isRequired = $derived((field.required || field.type === 'guest_name') && !disabled);

	let clientError = $derived(
		touched && !disabled ? validateFieldValue(field, liveValue || value || '') : null
	);
	let displayError = $derived(error || clientError);
	let errorId = $derived(`${field.name}-error`);
</script>

<div class="field" bind:this={container}>
	<label for={field.name}>
		{field.label}{#if isRequired}
			<span class="required" aria-hidden="true">(required)</span>{/if}
	</label>
	{#if field.type === 'guest_name'}
		<input
			id={field.name}
			name={field.name}
			type="text"
			required={!disabled}
			{disabled}
			autocomplete="name"
			maxlength="200"
			{value}
			aria-invalid={displayError ? 'true' : undefined}
			aria-describedby={displayError ? errorId : undefined}
			onblur={() => (touched = true)}
		/>
	{:else if field.type === 'guest_email'}
		<input
			id={field.name}
			name={field.name}
			type="email"
			required={field.required && !disabled}
			{disabled}
			autocomplete="email"
			maxlength="254"
			{value}
			aria-invalid={displayError ? 'true' : undefined}
			aria-describedby={displayError ? errorId : undefined}
			onblur={() => (touched = true)}
		/>
	{:else if field.type === 'number'}
		<input
			id={field.name}
			name={field.name}
			type="number"
			required={field.required && !disabled}
			{disabled}
			{value}
			aria-invalid={displayError ? 'true' : undefined}
			aria-describedby={displayError ? errorId : undefined}
			onblur={() => (touched = true)}
		/>
	{:else if field.type === 'phone'}
		<input
			id={field.name}
			name={field.name}
			type="tel"
			inputmode="tel"
			autocomplete="tel"
			required={field.required && !disabled}
			{disabled}
			pattern={PHONE_PATTERN}
			maxlength="25"
			{value}
			aria-invalid={displayError ? 'true' : undefined}
			aria-describedby={displayError ? errorId : undefined}
			onblur={() => (touched = true)}
		/>
	{:else if field.type === 'paragraph'}
		<textarea
			id={field.name}
			name={field.name}
			rows="3"
			required={field.required && !disabled}
			{disabled}
			maxlength="1000"
			{value}
			aria-invalid={displayError ? 'true' : undefined}
			aria-describedby={displayError ? errorId : undefined}
			onblur={() => (touched = true)}
		></textarea>
		{#if !disabled}
			<span class="count">{liveValue.length}/1000</span>
		{/if}
	{:else if field.type === 'choice' || (field.type === 'event_location' && field.choices)}
		<select
			id={field.name}
			name={field.name}
			required={field.required && !disabled}
			{disabled}
			aria-invalid={displayError ? 'true' : undefined}
			aria-describedby={displayError ? errorId : undefined}
			onblur={() => (touched = true)}
		>
			{#if !field.required}<option value="">Select an option</option>{/if}
			{#each field.choices ?? [] as choice (choice)}
				<option value={choice} selected={choice === value}>{choice}</option>
			{/each}
		</select>
	{:else}
		<input
			id={field.name}
			name={field.name}
			type="text"
			required={field.required && !disabled}
			{disabled}
			maxlength="200"
			{value}
			aria-invalid={displayError ? 'true' : undefined}
			aria-describedby={displayError ? errorId : undefined}
			onblur={() => (touched = true)}
		/>
	{/if}
	{#if displayError}
		<p id={errorId} class="error" role="alert">{displayError}</p>
	{/if}
</div>

<style>
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

	.required {
		font-weight: 400;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-left: var(--space-2);
	}

	.field input,
	.field select,
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

	.field input:focus,
	.field select:focus,
	.field textarea:focus {
		outline: none;
		border-color: var(--when-color-primary);
		box-shadow: var(--shadow-focus);
	}

	.field input[aria-invalid='true'],
	.field select[aria-invalid='true'],
	.field textarea[aria-invalid='true'],
	.field input:user-invalid,
	.field select:user-invalid,
	.field textarea:user-invalid {
		border-color: var(--color-danger);
	}

	.field input[aria-invalid='true']:focus,
	.field select[aria-invalid='true']:focus,
	.field textarea[aria-invalid='true']:focus,
	.field input:user-invalid:focus,
	.field select:user-invalid:focus,
	.field textarea:user-invalid:focus {
		border-color: var(--color-danger);
		box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.2);
	}

	.count {
		display: block;
		margin-top: var(--space-1);
		text-align: right;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.error {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-sm);
		color: var(--color-danger);
	}

	input:disabled,
	textarea:disabled,
	select:disabled {
		background: var(--color-surface-muted);
		border-color: var(--color-border);
		color: var(--color-text-muted);
		cursor: not-allowed;
		opacity: 0.7;
	}
</style>
