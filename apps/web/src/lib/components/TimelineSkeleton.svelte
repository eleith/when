<!-- Placeholder shown on step 2 while the viewer timezone resolves client-side. -->
<script lang="ts">
	interface Props {
		rows: number;
		showDuration?: boolean;
	}

	let { rows, showDuration = false }: Props = $props();
</script>

<div class="skeleton" aria-hidden="true">
	<div class="header">
		<span class="timezone"></span>
		{#if showDuration}
			<span class="stepper-placeholder"></span>
		{/if}
	</div>
	<div class="scroll">
		<div class="track" style:height="{rows * 96}px">
			{#each Array.from({ length: rows }, (_, i) => i) as i (i)}
				<div class="row" style:top="{i * 96}px">
					<span class="label"></span>
					<span class="gridline"></span>
				</div>
			{/each}
			<span class="slot"></span>
		</div>
	</div>
</div>

<style>
	.skeleton {
		width: 100%;
		display: flex;
		flex-direction: column;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--space-7);
		background: var(--color-quiet-bg);
		border-bottom: 1px solid var(--color-border);
		min-height: 44px;
	}

	@media (max-width: 768px) {
		.header {
			padding: var(--space-3) var(--space-5);
		}
	}

	.stepper-placeholder {
		width: 7rem;
		height: 38px;
		border-radius: var(--radius);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	.timezone {
		width: 5rem;
		height: 38px;
		border-radius: var(--radius);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	.scroll {
		position: relative;
		max-height: 60vh;
		overflow: hidden;
		padding: var(--space-4) var(--space-7) var(--space-4) 0;
	}

	@media (max-width: 768px) {
		.scroll {
			padding: var(--space-4) var(--space-5) var(--space-4) 0;
		}
	}

	.track {
		position: relative;
		margin-left: 60px;
		border-left: 1px solid var(--color-border-strong);
	}

	.row {
		position: absolute;
		left: 0;
		right: 0;
	}

	.label {
		position: absolute;
		left: -60px;
		top: -0.5em;
		width: 40px;
		height: var(--font-size-sm);
		border-radius: var(--radius-sm);
		background: var(--color-surface-muted);
	}

	.gridline {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		height: 1px;
		background: var(--color-border);
	}

	.slot {
		position: absolute;
		left: var(--space-4);
		right: var(--space-4);
		top: 112px;
		height: 48px;
		border-radius: var(--radius-sm);
		background: var(--color-surface-muted);
	}

	@media (max-width: 768px) {
		.scroll {
			max-height: none;
			overflow: visible;
		}
	}
</style>
