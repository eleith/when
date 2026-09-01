<script lang="ts">
	import IconWarning from 'virtual:icons/ph/warning';
	import AdminAlert from '$lib/components/AdminAlert.svelte';
	import AdminPage from '$lib/components/AdminPage.svelte';

	let { data } = $props();

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

<AdminPage>
	<div class="dashboard">
		<h1 class="visibility-hidden">Dashboard</h1>

		{#if data.conflictCount > 0 || data.failing.length > 0}
			<section class="alerts">
				{#if data.conflictCount > 0}
					<AdminAlert href="/admin/appointments/upcoming">
						{data.conflictCount} possible conflict{#if data.conflictCount !== 1}s{/if}
					</AdminAlert>
				{/if}
				{#each data.failing as f (f.name)}
					<AdminAlert href="/admin/health">{f.name}: {f.reason}</AdminAlert>
				{/each}
			</section>
		{/if}

		<div class="section-group">
			<h2 class="section-label">Upcoming</h2>
			<section class="card preview-card">
				<div class="card-body">
					{#if data.upcoming.length === 0}
						<div class="empty-preview">
							<p class="empty-text">No upcoming appointments.</p>
						</div>
					{:else}
						<ul class="preview-list">
							{#each data.upcoming as a (a.id)}
								<li class="preview-row" class:past={a.is_past}>
									<div class="details-guest">
										<div class="guest-info">
											<a href="/appointment/{a.id}" class="row-link">{a.guest_name}</a>
											<span class="guest-email" class:no-email={!a.guest_email}>
												{a.guest_email ?? 'No email'}
											</span>
										</div>
									</div>
									<div class="details-event">
										<span class="event-tag">{a.event_type_name}</span>
									</div>
									<div class="details-time">
										<span class="time-text">{fmt(a.start_time)}</span>
									</div>
									<div class="details-status">
										<div class="status-wrapper">
											<span class="status-badge status-{a.display_status}">
												{#if a.display_status === 'in_progress'}
													in progress
												{:else}
													{a.display_status}
												{/if}
											</span>
											{#if a.possible_conflict}
												<span
													class="conflict-chip"
													title="This time overlaps a busy event on a conflict calendar"
												>
													<IconWarning class="conflict-icon" aria-hidden="true" />
													Conflict
												</span>
											{/if}
										</div>
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</section>
		</div>

		{#if data.pending.length > 0}
			<hr class="section-divider" />

			<div class="section-group">
				<h2 class="section-label">Pending review</h2>
				<section class="card preview-card">
					<div class="card-body">
						<ul class="preview-list">
							{#each data.pending as a (a.id)}
								<li class="preview-row" class:past={a.is_past}>
									<div class="details-guest">
										<div class="guest-info">
											<a href="/appointment/{a.id}" class="row-link">{a.guest_name}</a>
											<span class="guest-email" class:no-email={!a.guest_email}>
												{a.guest_email ?? 'No email'}
											</span>
										</div>
									</div>
									<div class="details-event">
										<span class="event-tag">{a.event_type_name}</span>
									</div>
									<div class="details-time">
										<span class="time-text">{fmt(a.start_time)}</span>
									</div>
									<div class="details-status">
										<div class="status-wrapper">
											<span class="status-badge status-{a.display_status}">
												{#if a.display_status === 'in_progress'}
													in progress
												{:else}
													{a.display_status}
												{/if}
											</span>
											{#if a.possible_conflict}
												<span
													class="conflict-chip"
													title="This time overlaps a busy event on a conflict calendar"
												>
													<IconWarning class="conflict-icon" aria-hidden="true" />
													Conflict
												</span>
											{/if}
										</div>
									</div>
								</li>
							{/each}
						</ul>
					</div>
				</section>
			</div>
		{/if}

		<hr class="section-divider" />

		<div class="section-group">
			<h2 class="section-label">Statistics</h2>
			<div class="stats-row">
				<a href="/admin/appointments/past" class="stat-card">
					<span class="stat-value">{fmtHours(data.confirmedMinutesThisWeek)}</span>
					<span class="stat-label">scheduled this week</span>
				</a>
				<a href="/admin/appointments/past" class="stat-card">
					<span class="stat-value">{data.totalThisMonth}</span>
					<span class="stat-label">total this month</span>
				</a>
				<a href="/admin/appointments/past" class="stat-card">
					<span class="stat-value">{data.lifetimeMeetings}</span>
					<span class="stat-label">lifetime meetings</span>
				</a>
				<a href="/admin/appointments/past" class="stat-card">
					<span class="stat-value">{fmtHours(data.lifetimeMinutes)}</span>
					<span class="stat-label">lifetime meeting time</span>
				</a>
			</div>
		</div>

		<hr class="section-divider" />

		<div class="section-group">
			<h2 class="section-label">Setup</h2>
			<div class="stats-row">
				<a href="/admin/health" class="stat-card">
					<span class="stat-value">{data.serviceCount}</span>
					<span class="stat-label">
						service{#if data.serviceCount !== 1}s{/if}
					</span>
				</a>
				<a href="/admin/health#calendars" class="stat-card">
					<span class="stat-value">{data.calendarCount}</span>
					<span class="stat-label">
						calendar{#if data.calendarCount !== 1}s{/if}
					</span>
				</a>
			</div>
		</div>

		{#if data.purgedCount > 0}
			<div class="purged-link">
				<a href="/admin/appointments/purged">View purged appointments</a>
			</div>
		{/if}
	</div>
</AdminPage>

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}

	/* ---- alerts ---- */
	.alerts {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* ---- divider ---- */
	.section-divider {
		border: 0;
		border-top: 1px solid var(--color-border);
		margin: 0;
	}

	/* ---- section groups ---- */
	.section-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
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
		text-decoration: none;
		color: inherit;
	}

	a.stat-card:hover {
		border-color: var(--color-border-strong);
		background: var(--color-surface-active);
	}

	a.stat-card:focus-visible {
		outline: 2px solid var(--when-color-primary);
		outline-offset: 2px;
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

	/* ---- preview cards ---- */
	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.card-body {
		padding: 0;
	}

	.empty-preview {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-8) var(--space-4);
		text-align: center;
	}

	.empty-text {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
		margin: 0;
	}

	.preview-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.preview-row {
		position: relative;
		display: grid;
		grid-template-columns: 2fr 1.2fr 2.2fr 1.5fr;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-md);
		transition: background var(--transition);
	}

	.preview-row:last-child {
		border-bottom: none;
	}

	.preview-row:hover,
	.preview-row:focus-within {
		background: var(--when-color-surface-page);
	}

	.details-guest,
	.details-event,
	.details-time,
	.details-status {
		min-width: 0;
	}

	/* rows styling for past events */
	.preview-row.past {
		color: var(--color-text-muted);
	}

	.preview-row.past .row-link {
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	.preview-row.past .event-tag {
		background: var(--color-surface-muted);
		color: var(--color-text-muted);
	}

	/* cell specifics */
	.guest-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.row-link {
		color: var(--when-color-text);
		text-decoration: none;
		font-weight: 600;
		font-size: var(--font-size-lg);
	}

	.row-link::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.row-link:focus-visible {
		outline: 2px solid var(--when-color-primary);
		outline-offset: -2px;
	}

	.guest-email {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.guest-email.no-email {
		font-style: italic;
	}

	.event-tag {
		display: inline-block;
		font-size: var(--font-size-sm);
		font-weight: 600;
		background: var(--color-surface-muted);
		color: var(--color-text-secondary);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.time-text {
		font-weight: 500;
		font-size: var(--font-size-base);
		white-space: nowrap;
	}

	.status-wrapper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.conflict-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		font-weight: 600;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-warning) 12%, transparent);
		color: var(--color-warning);
		white-space: nowrap;
	}

	:global(.conflict-icon) {
		width: 14px;
		height: 14px;
		color: var(--color-warning);
		flex-shrink: 0;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		font-size: var(--font-size-sm);
		font-weight: 600;
		text-transform: capitalize;
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.status-confirmed {
		background: var(--color-info-bg);
		color: var(--color-info-strong);
	}

	.status-in_progress {
		background: var(--color-success-bg);
		color: var(--color-success-strong);
	}

	.status-pending {
		background: var(--color-warning-bg);
		color: var(--color-warning-strong);
	}

	.status-concluded,
	.status-rescheduled {
		background: var(--color-quiet-bg);
		color: var(--color-quiet-strong);
	}

	.status-declined,
	.status-cancelled,
	.status-expired {
		background: var(--color-danger-bg);
		color: var(--color-danger-strong);
	}

	@media (prefers-color-scheme: dark) {
		.status-declined,
		.status-cancelled,
		.status-expired {
			color: var(--color-danger);
		}
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

		.preview-row {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: var(--space-1) var(--space-3);
			align-items: start;
			padding: var(--space-3) var(--space-4);
		}

		.details-guest {
			grid-column: 1;
			grid-row: 1;
		}

		.details-status {
			grid-column: 2;
			grid-row: 1;
			justify-self: end;
		}

		.details-time {
			grid-column: 1;
			grid-row: 2;
		}

		.details-event {
			grid-column: 2;
			grid-row: 2;
			justify-self: end;
		}
	}
</style>
