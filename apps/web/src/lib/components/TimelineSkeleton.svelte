<!-- Placeholder shown on step 2 while the viewer timezone resolves client-side. -->
<script lang="ts">
	interface Props {
		rows: number;
	}

	let { rows }: Props = $props();
</script>

<div class="skeleton" aria-hidden="true">
	<div class="header">
		<span class="heading"></span>
		<span class="timezone"></span>
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
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-7);
	}

	.heading {
		height: var(--font-size-xl);
		width: 9rem;
		border-radius: var(--radius-sm);
		background: var(--color-surface-muted);
	}

	.timezone {
		align-self: center;
		width: 4rem;
		height: var(--font-size-md);
		border-radius: var(--radius-sm);
		background: var(--color-surface-muted);
	}

	.scroll {
		position: relative;
		max-height: 60vh;
		overflow: hidden;
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
