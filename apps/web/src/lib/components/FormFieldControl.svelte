<!-- One labelled guest-input, rendered per configured form field type. -->
<script lang="ts">
	import type { FormField } from '@when/config';
	import { PHONE_PATTERN } from '$lib/forms/phone';

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

	$effect(() => {
		if (focusOnMount) container?.querySelector<HTMLElement>('input, select, textarea')?.focus();
	});
</script>

<div class="field" bind:this={container}>
	<label for={field.name}>
		{field.label}{#if field.required && !disabled}<span class="required" aria-hidden="true">*</span
			>{/if}
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
		/>
	{:else if field.type === 'number'}
		<input
			id={field.name}
			name={field.name}
			type="number"
			required={field.required && !disabled}
			{disabled}
			{value}
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
		></textarea>
		{#if !disabled}
			<span class="count">{liveValue.length}/1000</span>
		{/if}
	{:else if field.type === 'choice' || (field.type === 'event_location' && field.choices)}
		<select id={field.name} name={field.name} required={field.required && !disabled} {disabled}>
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
		/>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
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
		color: var(--text-secondary);
	}

	.required {
		color: var(--danger);
		margin-left: 2px;
	}

	.field input,
	.field select,
	.field textarea {
		width: 100%;
		padding: var(--space-4) var(--space-4);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		box-sizing: border-box;
		transition: border-color var(--transition);
		background: var(--surface);
		color: var(--when-color-text);
	}

	.field input:focus,
	.field select:focus,
	.field textarea:focus {
		outline: none;
		border-color: var(--when-color-primary);
		box-shadow: var(--shadow-focus);
	}

	.count {
		display: block;
		margin-top: var(--space-1);
		text-align: right;
		font-size: var(--font-size-xs);
		color: var(--text-muted);
	}

	.error {
		margin: var(--space-2) 0 0;
		font-size: var(--font-size-sm);
		color: var(--danger);
	}

	input:disabled,
	textarea:disabled,
	select:disabled {
		background: var(--surface-muted);
		border-color: var(--border);
		color: var(--text-muted);
		cursor: not-allowed;
		opacity: 0.7;
	}
</style>
