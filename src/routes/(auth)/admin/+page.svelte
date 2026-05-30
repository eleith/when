<script lang="ts">
	import IconSignOut from 'virtual:icons/ph/sign-out';
	import IconGear from 'virtual:icons/ph/gear';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconUser from 'virtual:icons/ph/user';
	import IconWarning from 'virtual:icons/ph/warning';
	import IconCheck from 'virtual:icons/ph/check';
	import IconX from 'virtual:icons/ph/x';
	import IconEnvelope from 'virtual:icons/ph/envelope';
	import IconLockKey from 'virtual:icons/ph/lock-key';

	let { data } = $props();

	let configOpen = $state(false);

	function fmt(iso: string): string {
		return new Date(iso).toLocaleString([], {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<svelte:head>
	<title>Admin Dashboard — When</title>
</svelte:head>

<div class="admin-container">
	<header class="admin-header">
		<div class="brand">
			<span class="brand-logo">When</span>
			<span class="badge-role">Admin</span>
		</div>
		<div class="user-menu">
			<span class="user-info">
				<IconUser class="user-icon" aria-hidden="true" />
				{data.session.user?.name ?? 'unknown'}
			</span>
			<form method="POST" action="?/signout" class="signout-form">
				<button type="submit" class="signout-btn">
					<IconSignOut class="btn-icon" aria-hidden="true" />
					Sign out
				</button>
			</form>
		</div>
	</header>

	<main class="admin-main">
		<div class="section-header">
			<h1 class="page-title">Bookings</h1>
			<p class="page-subtitle">Manage appointments and requests</p>
		</div>

		{#if data.appointments.length === 0}
			<div class="card empty-card">
				<IconCalendarBlank class="empty-icon" aria-hidden="true" />
				<p class="empty-text">No appointments scheduled yet.</p>
			</div>
		{:else}
			<div class="card table-card">
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Attendee</th>
								<th>Event type</th>
								<th>Date & Time</th>
								<th>Status</th>
								<th class="actions-th">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each data.appointments as a (a.id)}
								<tr class:past={a.is_past}>
									<td class="cell-attendee">
										<div class="attendee-info">
											<a href="/booked/{a.id}" class="row-link">{a.attendee_name}</a>
											<span class="attendee-email">
												<IconEnvelope class="cell-icon" aria-hidden="true" />
												{a.attendee_email}
											</span>
										</div>
									</td>
									<td class="cell-event">
										<span class="event-tag">{a.event_type_name}</span>
									</td>
									<td class="cell-time">
										<span class="time-text">{fmt(a.start_time)}</span>
									</td>
									<td class="cell-status">
										<div class="status-wrapper">
											<span class="status-badge status-{a.display_status}">
												{#if a.display_status === 'in_progress'}
													in progress
												{:else}
													{a.display_status}
												{/if}
											</span>
											{#if a.notification_status}
												<span class="notif-warn" title={a.notification_status}>
													<IconWarning aria-hidden="true" />
												</span>
											{/if}
										</div>
									</td>
									<td class="cell-actions">
										{#if a.status === 'pending' && !a.is_past}
											<div class="action-buttons">
												<form method="POST" action="/booked/{a.id}?/accept" class="action-form">
													<button type="submit" class="action-btn accept" title="Accept Booking">
														<IconCheck class="action-icon" aria-hidden="true" />
														Accept
													</button>
												</form>
												<form method="POST" action="/booked/{a.id}?/decline" class="action-form">
													<button type="submit" class="action-btn decline" title="Decline Booking">
														<IconX class="action-icon" aria-hidden="true" />
														Decline
													</button>
												</form>
											</div>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<section class="config-section">
			<div class="config-toggle-header">
				<button class="config-toggle-btn" onclick={() => (configOpen = !configOpen)}>
					<IconGear class="config-icon" aria-hidden="true" />
					<span>System Configuration</span>
					<span class="chevron">{configOpen ? '▼' : '▶'}</span>
				</button>
			</div>

			{#if configOpen}
				<div class="card config-card">
					<div class="config-info-banner">
						<IconLockKey class="info-icon" aria-hidden="true" />
						<p>Sensitive credentials and API secrets are masked for safety.</p>
					</div>
					<pre class="config-block"><code>{JSON.stringify(data.config, null, 2)}</code></pre>
				</div>
			{/if}
		</section>
	</main>
</div>

<style>
	.admin-container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 0 var(--space-6) var(--space-10);
		color: var(--text);
	}

	/* ---- header navigation ---- */
	.admin-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-5) 0;
		border-bottom: 1px solid var(--border);
		margin-bottom: var(--space-8);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.brand-logo {
		font-size: var(--font-size-xl);
		font-weight: 800;
		letter-spacing: -0.025em;
		color: var(--primary);
	}

	.badge-role {
		font-size: var(--font-size-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		background: var(--primary-muted);
		color: var(--primary);
		padding: var(--space-1) var(--space-2_5, 8px);
		border-radius: var(--radius-pill);
	}

	.user-menu {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}

	.user-info {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: 500;
		color: var(--text-secondary);
	}

	:global(.user-icon) {
		font-size: var(--font-size-md);
		color: var(--text-muted);
	}

	.signout-form {
		margin: 0;
	}

	.signout-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-xs);
		font-weight: 600;
		color: var(--text-secondary);
		cursor: pointer;
		transition:
			background var(--transition),
			border-color var(--transition),
			color var(--transition);
	}

	.signout-btn:hover {
		background: var(--surface-muted);
		border-color: var(--text-muted);
		color: var(--text);
	}

	:global(.btn-icon) {
		font-size: var(--font-size-sm);
	}

	/* ---- main layout ---- */
	.admin-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.section-header {
		margin-bottom: var(--space-2);
	}

	.page-title {
		font-size: var(--font-size-2xl);
		font-weight: 800;
		letter-spacing: -0.02em;
		margin: 0 0 var(--space-1);
	}

	.page-subtitle {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		margin: 0;
	}

	/* ---- card styling ---- */
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.empty-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-10) var(--space-6);
		text-align: center;
		gap: var(--space-4);
	}

	:global(.empty-icon) {
		font-size: var(--font-size-3xl);
		color: var(--text-disabled);
	}

	.empty-text {
		font-size: var(--font-size-md);
		color: var(--text-muted);
		margin: 0;
	}

	/* ---- table design ---- */
	.table-card {
		border-radius: var(--radius-md);
	}

	.table-wrap {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
	}

	th {
		background: var(--surface-page);
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--border);
	}

	td {
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
		font-size: var(--font-size-base);
	}

	tr:last-child td {
		border-bottom: none;
	}

	tr {
		transition: background var(--transition);
	}

	tr:hover {
		background: var(--surface-page);
	}

	/* rows styling for past events */
	tr.past td {
		color: var(--text-disabled);
	}

	tr.past .row-link {
		color: var(--text-secondary);
		font-weight: 500;
	}

	tr.past .event-tag {
		background: var(--surface-muted);
		color: var(--text-disabled);
	}

	/* cell specifics */
	.attendee-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.row-link {
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
		font-size: var(--font-size-md);
		transition: color var(--transition);
	}

	.row-link:hover {
		color: var(--primary);
	}

	.attendee-email {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		color: var(--text-muted);
	}

	:global(.cell-icon) {
		font-size: var(--font-size-xs);
		color: var(--text-disabled);
	}

	.event-tag {
		display: inline-block;
		font-size: var(--font-size-xs);
		font-weight: 600;
		background: var(--primary-muted);
		color: var(--primary);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-sm);
	}

	.time-text {
		font-weight: 500;
		font-size: var(--font-size-sm);
	}

	.status-wrapper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		font-size: var(--font-size-xs);
		font-weight: 700;
		text-transform: capitalize;
		padding: var(--space-1) var(--space-2_5, 8px);
		border-radius: var(--radius-pill);
		line-height: 1;
	}

	.status-confirmed {
		background: var(--success-bg);
		color: var(--success-strong);
	}

	.status-pending {
		background: color-mix(in srgb, var(--warning) 10%, transparent);
		color: var(--warning);
	}

	.status-in_progress {
		background: var(--primary-muted);
		color: var(--primary);
	}

	.status-concluded {
		background: var(--surface-muted);
		color: var(--text-secondary);
	}

	.status-cancelled,
	.status-declined {
		background: var(--danger-bg);
		color: var(--danger-strong);
	}

	.notif-warn {
		display: inline-flex;
		color: var(--warning);
		font-size: var(--font-size-sm);
		cursor: help;
	}

	/* actions alignment */
	.actions-th,
	.cell-actions {
		text-align: right;
	}

	.action-buttons {
		display: inline-flex;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	.action-form {
		margin: 0;
		display: inline-block;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		font-weight: 700;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		cursor: pointer;
		transition:
			background var(--transition),
			border-color var(--transition),
			color var(--transition);
	}

	.action-btn.accept {
		background: var(--success-bg);
		color: var(--success-strong);
		border-color: var(--success-border);
	}

	.action-btn.accept:hover {
		background: var(--success);
		color: var(--text-on-primary);
		border-color: var(--success);
	}

	.action-btn.decline {
		background: var(--danger-bg);
		color: var(--danger-strong);
		border-color: var(--danger-border);
	}

	.action-btn.decline:hover {
		background: var(--danger);
		color: var(--text-on-primary);
		border-color: var(--danger);
	}

	:global(.action-icon) {
		font-size: var(--font-size-xs);
	}

	/* ---- config section ---- */
	.config-section {
		margin-top: var(--space-4);
	}

	.config-toggle-header {
		display: flex;
	}

	.config-toggle-btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: var(--font-size-md);
		font-weight: 600;
		color: var(--text-secondary);
		padding: var(--space-2) 0;
		transition: color var(--transition);
	}

	.config-toggle-btn:hover {
		color: var(--text);
	}

	:global(.config-icon) {
		font-size: var(--font-size-md);
	}

	.chevron {
		font-size: var(--font-size-xs);
		color: var(--text-muted);
		margin-left: var(--space-1);
	}

	.config-card {
		margin-top: var(--space-4);
		padding: var(--space-5);
		background: var(--surface);
	}

	.config-info-banner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--surface-page);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--space-3) var(--space-4);
		margin-bottom: var(--space-4);
		font-size: var(--font-size-xs);
		color: var(--text-secondary);
	}

	:global(.info-icon) {
		font-size: var(--font-size-md);
		color: var(--text-muted);
	}

	.config-info-banner p {
		margin: 0;
	}

	.config-block {
		margin: 0;
		padding: var(--space-4);
		background: var(--surface-page);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		font-size: var(--font-size-sm);
		line-height: 1.5;
	}

	.config-block code {
		font-family: var(--font-mono, monospace);
		color: var(--text-secondary);
	}

	/* ---- responsive overrides ---- */
	@media (max-width: 768px) {
		.admin-container {
			padding: 0 var(--space-4) var(--space-8);
		}

		.admin-header {
			margin-bottom: var(--space-6);
		}

		th,
		td {
			padding: var(--space-3) var(--space-4);
		}

		.action-btn span {
			display: none; /* Icon only on tiny screens if crowded, or just adapt layout */
		}
	}
</style>
