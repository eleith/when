<!-- The wizard's action bar: current step, selection summary, and the navigation/submit buttons. -->
<script lang="ts">
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import { formatDate, formatTime } from '$lib/datetime';
	import type { AppointmentFlow } from '$lib/appointmentFlow.svelte';
	import type { PublicEventType } from '$lib/server/appointment/sanitize';

	interface Props {
		flow: AppointmentFlow;
		isReschedule: boolean;
		bookingApproval: PublicEventType['booking_approval'];
	}

	let { flow, isReschedule, bookingApproval }: Props = $props();

	// read-only views of the shared flow; navigation goes through flow.* below
	let step = $derived(flow.step);
	let viewDate = $derived(flow.viewDate);
	let selectedSlot = $derived(flow.selectedSlot);
	let userTz = $derived(flow.userTz);
</script>

<div class="actions">
	<p class="title">
		<span class="step-label">Step {step} of 3:</span>
		{#if step === 1}Pick a day{:else if step === 2}Pick a time{:else}Enter your info{/if}
	</p>
	{#if step === 1 && viewDate}
		<p class="summary">You selected {formatDate(viewDate)}</p>
	{:else if step === 2 && selectedSlot}
		<p class="summary">You selected {formatTime(selectedSlot, userTz)}</p>
	{/if}

	{#if step === 1}
		<button type="button" class="button" onclick={flow.advance} disabled={!flow.canAdvance}>
			Continue <span class="arrow"><IconArrowRight aria-hidden="true" /></span>
		</button>
	{:else if step === 2}
		<button type="button" class="button button-secondary" onclick={flow.goBack}> Back </button>
		<button type="button" class="button" onclick={flow.advance} disabled={!flow.canAdvance}>
			Confirm <span class="arrow"><IconArrowRight aria-hidden="true" /></span>
		</button>
	{:else}
		<button type="button" class="button button-secondary" onclick={flow.goBack}> Back </button>
		<button type="submit" form="appointment-form" class="button" disabled={!selectedSlot}>
			{#if isReschedule}Confirm Reschedule{:else if bookingApproval === 'request'}Request{:else}Schedule{/if}
		</button>
	{/if}
</div>

<style>
	.step-label {
		font-weight: 500;
		color: var(--text-muted);
		margin-right: var(--space-2);
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-4);
		margin-top: var(--space-6);
		padding-top: var(--space-5);
		border-top: 1px solid var(--border);
	}

	.summary {
		margin: 0 auto 0 0;
		color: var(--text-secondary);
		font-size: var(--font-size-md);
		font-weight: 500;
		display: flex;
		align-items: center;
	}

	.arrow {
		display: inline-flex;
		margin-left: var(--space-2);
		transition: transform var(--transition);
	}

	.button:not(:disabled):hover .arrow {
		transform: translateX(2px);
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: var(--space-3) var(--space-7);
		background: var(--when-color-primary);
		color: var(--when-color-text-on-primary);
		border: none;
		border-radius: var(--radius);
		font-size: var(--font-size-md);
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--transition);
	}

	.button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.button:not(:disabled):hover {
		opacity: 0.9;
	}

	.button-secondary {
		background: transparent;
		color: var(--text-secondary);
		border: 1px solid var(--border-strong);
	}

	.button-secondary:not(:disabled):hover {
		background: var(--surface-active);
		color: var(--when-color-text);
		opacity: 1;
	}

	/* The step title lives in the sidebar on desktop, so the bar only shows it on mobile. */
	@media (min-width: 769px) {
		.title {
			display: none;
		}
	}

	@media (max-width: 768px) {
		.summary {
			display: none;
		}

		.title {
			margin: 0 0 var(--space-2);
			font-size: var(--font-size-md);
			font-weight: 600;
			color: var(--when-color-text);
		}

		.button {
			min-height: 56px;
			width: 100%;
			padding: var(--space-4) var(--space-6);
		}

		.button-secondary {
			display: none;
		}

		.actions {
			display: block;
			justify-content: initial;
			border-top: none;
			padding-top: 0;
			margin: 0;
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			padding: var(--space-4) var(--space-5) calc(var(--space-4) + env(safe-area-inset-bottom));
			background: var(--surface);
			border-top: 1px solid var(--border);
			z-index: 100;
		}
	}
</style>
