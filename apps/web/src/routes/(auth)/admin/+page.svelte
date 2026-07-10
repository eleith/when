<script lang="ts">
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconClock from 'virtual:icons/ph/clock';
	import IconTimer from 'virtual:icons/ph/timer';
	import IconWarning from 'virtual:icons/ph/warning';

	let { data } = $props();

	let badCalendars = $derived(data.calendars.filter((c) => c.health === 'bad'));

	function fmt(iso: string): string {
		return new Date(iso).toLocaleString([], {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function fmtHours(minutes: number): string {
		if (minutes < 60) return `${minutes}m`;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		if (h < 24) {
			if (m === 0) return `${h}h`;
			return `${h}h ${m}m`;
		}
		const d = Math.floor(h / 24);
		const rh = h % 24;
		if (rh === 0) return `${d}d`;
		return `${d}d ${rh}h`;
	}
</script>

<svelte:head>
	<title>Dashboard — When</title>
</svelte:head>

<div class="dashboard">
	{#if data.conflictCount > 0 || badCalendars.length > 0}
		<section class="alerts">
			{#if data.conflictCount > 0}
				<a href="/admin/appointments/upcoming" class="alert">
					<IconWarning aria-hidden="true" />
					<span>
						{data.conflictCount} possible conflict{#if data.conflictCount !== 1}s{/if} — review in upcoming
					</span>
					<span class="alert-arrow"><IconArrowRight aria-hidden="true" /></span>
				</a>
			{/if}
			{#each badCalendars as c (c.id)}
				<div class="alert" role="alert">
					<IconWarning aria-hidden="true" />
					<span>{c.id} — {c.reason ?? 'not syncing'}</span>
				</div>
			{/each}
		</section>
	{/if}

	<section class="stats">
		<div class="stat-card">
			<span class="stat-value">{data.upcomingCount}</span>
			<span class="stat-label">upcoming</span>
		</div>
		<div class="stat-card">
			<span class="stat-value pending-value">{data.pendingCount}</span>
			<span class="stat-label">pending</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{fmtHours(data.confirmedMinutesThisWeek)}</span>
			<span class="stat-label">scheduled this week</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.totalThisMonth}</span>
			<span class="stat-label">total this month</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{data.lifetimeMeetings}</span>
			<span class="stat-label">lifetime meetings</span>
		</div>
		<div class="stat-card">
			<span class="stat-value">{fmtHours(data.lifetimeMinutes)}</span>
			<span class="stat-label">lifetime meeting time</span>
		</div>
	</section>

	<div class="previews">
		{#if data.upcoming.length > 0}
			<section class="card preview-card">
				<div class="card-header">
					<h2 class="card-title">
						<IconCalendarBlank aria-hidden="true" />
						Upcoming
					</h2>
					{#if data.upcomingCount > 0}
						<a href="/admin/appointments/upcoming" class="header-link">
							view all <IconArrowRight aria-hidden="true" />
						</a>
					{/if}
				</div>
				<div class="card-body">
					<ul class="preview-list">
						{#each data.upcoming as a (a.id)}
							<li>
								<a href="/appointment/{a.id}" class="preview-item">
									<span class="preview-time">{fmt(a.start_time)}</span>
									<span class="preview-name">{a.guest_name}</span>
									<span class="preview-type">{a.event_type_name}</span>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			</section>
		{/if}

		{#if data.pending.length > 0}
			<section class="card preview-card">
				<div class="card-header">
					<h2 class="card-title">
						<IconClock aria-hidden="true" />
						Pending review
					</h2>
					{#if data.pendingCount > 0}
						<a href="/admin/appointments/pending" class="header-link">
							review all <IconArrowRight aria-hidden="true" />
						</a>
					{/if}
				</div>
				<div class="card-body">
					<ul class="preview-list">
						{#each data.pending as a (a.id)}
							<li>
								<a href="/appointment/{a.id}" class="preview-item">
									<span class="preview-time">{fmt(a.start_time)}</span>
									<span class="preview-name">{a.guest_name}</span>
									<span class="preview-type">{a.event_type_name}</span>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			</section>
		{/if}
	</div>

	<div class="quick-link">
		<a href="/admin/appointments/upcoming" class="manage-link">
			<IconTimer aria-hidden="true" />
			Manage appointments
			<IconArrowRight aria-hidden="true" />
		</a>
	</div>
</div>

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	/* ---- alerts ---- */
	.alerts {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.alert {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--warning) 12%, transparent);
		color: var(--warning);
		font-size: var(--font-size-sm);
		font-weight: 500;
		text-decoration: none;
	}

	a.alert:hover {
		background: color-mix(in srgb, var(--warning) 18%, transparent);
	}

	.alert-arrow {
		margin-left: auto;
		flex-shrink: 0;
		font-size: var(--font-size-base);
	}

	/* ---- stats ---- */
	.stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-3);
	}

	.stat-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.stat-value {
		font-size: var(--font-size-2xl);
		font-weight: 700;
		color: var(--text);
		line-height: 1.1;
	}

	.pending-value {
		color: var(--warning);
	}

	.stat-label {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
	}

	/* ---- previews ---- */
	.previews {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
		align-items: start;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.card-header {
		background: var(--surface-page);
		border-bottom: 1px solid var(--border);
		padding: var(--space-3) var(--space-4);
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.card-title {
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--text);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.header-link {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		text-decoration: none;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		transition: color var(--transition);
	}

	.header-link:hover {
		color: var(--text);
	}

	.card-body {
		padding: 0;
	}

	.preview-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.preview-item {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		text-decoration: none;
		color: var(--text);
		transition: background var(--transition);
	}

	.preview-item:hover {
		background: var(--surface-hover);
	}

	.preview-list > li + li {
		border-top: 1px solid var(--border);
	}

	.preview-time {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.preview-name {
		font-size: var(--font-size-sm);
		font-weight: 500;
	}

	.preview-type {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		margin-left: auto;
	}

	/* ---- quick link ---- */
	.quick-link {
		display: flex;
		justify-content: center;
	}

	.manage-link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
		text-decoration: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		transition:
			color var(--transition),
			border-color var(--transition);
	}

	.manage-link:hover {
		color: var(--text);
		border-color: var(--text-muted);
	}

	/* ---- responsive ---- */
	@media (max-width: 768px) {
		.dashboard {
			gap: var(--space-4);
		}

		.stats {
			grid-template-columns: repeat(2, 1fr);
		}

		.previews {
			grid-template-columns: 1fr;
		}
	}
</style>
