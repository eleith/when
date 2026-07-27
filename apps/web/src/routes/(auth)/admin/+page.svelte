<script lang="ts">
	import IconAddressBook from 'virtual:icons/ph/address-book';
	import IconArrowRight from 'virtual:icons/ph/arrow-right';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconClock from 'virtual:icons/ph/clock';
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
		if (minutes === 0) return '0 min';
		if (minutes < 60) return `${minutes} min`;
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		if (h < 24) {
			if (m === 0) return `${h} hr`;
			return `${h} hr ${m} min`;
		}
		const d = Math.floor(h / 24);
		const rh = h % 24;
		if (rh === 0) return `${d} day`;
		return `${d} day ${rh} hr`;
	}
</script>

<svelte:head>
	<title>Dashboard — When</title>
</svelte:head>

<div class="dashboard">
	<h1 class="visibility-hidden">Dashboard</h1>

	<div class="quick-link">
		<a href="/admin/appointments/upcoming" class="manage-link">
			<IconAddressBook aria-hidden="true" />
			Manage appointments
			<IconArrowRight aria-hidden="true" />
		</a>
	</div>

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

	<div class="stats-group">
		<h2 class="section-label">Right now</h2>
		<div class="stats-row">
			<div class="stat-card">
				<span class="stat-value">{data.upcomingCount}</span>
				<span class="stat-label">upcoming meetings</span>
			</div>
			<div class="stat-card">
				<span class="stat-value pending-value">{data.pendingCount}</span>
				<span class="stat-label">pending meetings</span>
			</div>
		</div>
	</div>

	<div class="stats-group">
		<h2 class="section-label">This week</h2>
		<div class="stats-row">
			<div class="stat-card">
				<span class="stat-value">{fmtHours(data.confirmedMinutesThisWeek)}</span>
				<span class="stat-label">scheduled</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">{data.totalThisMonth}</span>
				<span class="stat-label">total this month</span>
			</div>
		</div>
	</div>

	<div class="stats-group">
		<h2 class="section-label">Lifetime</h2>
		<div class="stats-row">
			<div class="stat-card">
				<span class="stat-value">{data.lifetimeMeetings}</span>
				<span class="stat-label">total meetings</span>
			</div>
			<div class="stat-card">
				<span class="stat-value">{fmtHours(data.lifetimeMinutes)}</span>
				<span class="stat-label">total meeting time</span>
			</div>
		</div>
	</div>

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

	<div class="purged-link">
		<a href="/admin/appointments/purged">View purged appointments</a>
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
		background: color-mix(in srgb, var(--color-warning) 12%, transparent);
		color: var(--color-warning);
		font-size: var(--font-size-sm);
		font-weight: 500;
		text-decoration: none;
	}

	a.alert:hover {
		background: color-mix(in srgb, var(--color-warning) 18%, transparent);
	}

	.alert-arrow {
		margin-left: auto;
		flex-shrink: 0;
		font-size: var(--font-size-base);
	}

	/* ---- stats ---- */
	.stats-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.section-label {
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0;
	}

	.stats-row {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-3);
	}

	.stat-card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.stat-value {
		font-size: var(--font-size-2xl);
		font-weight: 700;
		color: var(--when-color-text);
		line-height: 1.1;
	}

	.pending-value {
		color: var(--color-warning);
	}

	.stat-label {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
	}

	/* ---- previews ---- */
	.previews {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
		align-items: start;
	}

	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.card-header {
		background: var(--when-color-surface-page);
		border-bottom: 1px solid var(--color-border);
		padding: var(--space-3) var(--space-4);
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.card-title {
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--when-color-text);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.header-link {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		text-decoration: none;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		transition: color var(--transition);
	}

	.header-link:hover {
		color: var(--when-color-text);
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
		color: var(--when-color-text);
		transition: background var(--transition);
	}

	.preview-item:hover {
		background: var(--surface-hover);
	}

	.preview-list > li + li {
		border-top: 1px solid var(--color-border);
	}

	.preview-time {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		flex-shrink: 0;
	}

	.preview-name {
		font-size: var(--font-size-sm);
		font-weight: 500;
	}

	.preview-type {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
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
		padding: var(--space-3) var(--space-5);
		font-size: var(--font-size-base);
		font-weight: 500;
		color: var(--color-text-secondary);
		text-decoration: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		transition:
			color var(--transition),
			border-color var(--transition);
	}

	.manage-link:hover {
		color: var(--when-color-text);
		border-color: var(--color-text-muted);
	}

	/* ---- purged link ---- */
	.purged-link {
		display: flex;
		justify-content: center;
	}

	.purged-link a {
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		text-decoration: none;
		transition: color var(--transition);
	}

	.purged-link a:hover {
		color: var(--color-text-secondary);
		text-decoration: underline;
	}

	/* ---- responsive ---- */
	@media (max-width: 768px) {
		.dashboard {
			gap: var(--space-4);
		}

		.previews {
			grid-template-columns: 1fr;
		}
	}
</style>
