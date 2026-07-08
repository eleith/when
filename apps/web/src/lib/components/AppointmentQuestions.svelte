<script lang="ts">
	import type { GuestAnswer } from '@when/config';
	import IconQuestion from 'virtual:icons/ph/question';
	import IconCaretDown from 'virtual:icons/ph/caret-down';

	let {
		answers
	}: {
		answers: GuestAnswer[];
	} = $props();
</script>

<details class="questions-section">
	<summary class="questions-summary">
		<span class="questions-summary-icon"><IconQuestion aria-hidden="true" /></span>
		<span class="questions-summary-text">
			<span class="questions-summary-title">Form questions</span>
			<span class="questions-summary-count">
				{answers.length}
				{answers.length === 1 ? 'question' : 'questions'} answered
			</span>
		</span>
		<span class="questions-summary-chevron"><IconCaretDown aria-hidden="true" /></span>
	</summary>

	<div class="questions-body">
		<ol class="questions-list">
			{#each answers as answer (answer.name)}
				<li class="questions-item">
					<div class="questions-label">{answer.label}</div>
					<div class="questions-value notes">{answer.value}</div>
				</li>
			{/each}
		</ol>
	</div>
</details>

<style>
	/* Mirrors AppointmentLog: a collapsible section with its own top divider. */
	.questions-section {
		border-top: 1px solid var(--border);
	}

	.questions-summary {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
		padding: var(--space-6) var(--space-7);
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		list-style: none;
		user-select: none;
	}

	.questions-summary::-webkit-details-marker {
		display: none;
	}

	.questions-summary:hover {
		background: var(--surface-muted);
	}

	.questions-summary-icon {
		font-size: var(--font-size-xl);
		color: var(--text-muted);
		display: inline-flex;
		flex-shrink: 0;
		margin-top: 1px;
	}

	.questions-summary-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.questions-summary-title {
		font-weight: 500;
		font-size: var(--font-size-lg);
		line-height: 1.4;
		color: var(--text);
	}

	.questions-summary-count {
		color: var(--text-muted);
		font-size: var(--font-size-base);
		margin-top: 2px;
	}

	.questions-summary-chevron {
		margin-left: auto;
		align-self: center;
		display: inline-flex;
		color: var(--text-muted);
		transition: transform var(--transition);
	}

	.questions-section[open] .questions-summary-chevron {
		transform: rotate(180deg);
	}

	.questions-body {
		padding: var(--space-5) var(--space-7) var(--space-6);
		border-bottom: 1px solid var(--border);
	}

	/* Indented with a guide rail so answers read as nested under the summary. */
	.questions-list {
		list-style: none;
		margin: 0 0 0 var(--space-4);
		padding: var(--space-1) 0 var(--space-1) var(--space-6);
		border-left: 2px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.questions-item {
		min-width: 0;
	}

	.questions-label {
		color: var(--text-muted);
		font-size: var(--font-size-base);
	}

	.questions-value {
		color: var(--text);
		font-weight: 500;
		font-size: var(--font-size-lg);
		line-height: 1.4;
		margin-top: 2px;
	}

	.notes {
		white-space: pre-wrap;
	}

	@media (max-width: 768px) {
		.questions-summary {
			padding: var(--space-5) var(--space-5);
		}

		.questions-body {
			padding: 0 var(--space-5) var(--space-5);
		}
	}
</style>
