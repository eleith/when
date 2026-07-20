<!-- Placeholder shown on step 1 while the viewer timezone resolves client-side. -->
<div class="skeleton" aria-hidden="true">
	<div class="header">
		<span class="heading"></span>
		<div class="nav">
			<span class="nav-button"></span>
			<span class="nav-button"></span>
		</div>
	</div>
	<div class="grid">
		<div class="weekdays">
			{#each Array.from({ length: 7 }, (_, i) => i) as i (i)}
				<span class="weekday"></span>
			{/each}
		</div>
		{#each Array.from({ length: 6 }, (_, i) => i) as r (r)}
			<div class="week">
				{#each Array.from({ length: 7 }, (_, i) => i) as c (c)}
					<span class="day"></span>
				{/each}
			</div>
		{/each}
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
		background: var(--surface-muted);
	}

	.nav {
		display: flex;
		gap: var(--space-1);
	}

	.nav-button {
		width: var(--space-7);
		height: var(--space-7);
		border-radius: var(--radius-sm);
		background: var(--surface-muted);
	}

	.grid {
		width: 100%;
		max-width: 360px;
		margin: 0 auto;
	}

	.weekdays {
		display: flex;
		width: 100%;
		margin-bottom: var(--space-2);
		background: var(--surface-muted);
		border-radius: var(--radius-sm);
	}

	.weekday {
		flex: 1;
		height: calc(var(--font-size-xs) + var(--space-4));
	}

	.week {
		display: flex;
		width: 100%;
	}

	.day {
		flex: 1;
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.day::before {
		content: '';
		width: 55%;
		height: 55%;
		border-radius: 50%;
		background: var(--surface-muted);
	}
</style>
