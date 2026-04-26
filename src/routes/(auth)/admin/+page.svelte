<script lang="ts">
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
	<title>Admin — When</title>
</svelte:head>

<h1>Admin</h1>
<p>Signed in as {data.session.user?.name ?? 'unknown'}</p>

<form method="POST" action="/auth/signout" class="signout-form">
	<input type="hidden" name="csrfToken" value={data.csrfToken} />
	<button type="submit">Sign out</button>
</form>

<p class="links"><a href="/admin/overrides">Manage availability overrides &rarr;</a></p>

<h2>Appointments</h2>

{#if data.appointments.length === 0}
	<p class="empty">No appointments yet.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Name</th>
					<th>Email</th>
					<th>Event</th>
					<th>When</th>
					<th>Status</th>
					<th>Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each data.appointments as a (a.id)}
					<tr>
						<td>{a.attendee_name}</td>
						<td>{a.attendee_email}</td>
						<td>{a.event_type_name}</td>
						<td>{fmt(a.start_time)}</td>
						<td>
							<span class="status status-{a.status}">{a.status}</span>
							{#if a.notification_status}
								<span class="notif-warn" title={a.notification_status}>&#9888;</span>
							{/if}
						</td>
						<td>
							{#if a.status === 'pending' && a.response_token}
								<form
									method="POST"
									action="/admin/respond/{a.id}?action=accept&token={a.response_token}"
									class="action-form"
								>
									<input type="hidden" name="action" value="accept" />
									<input type="hidden" name="token" value={a.response_token} />
									<button type="submit" class="action-btn accept">Accept</button>
								</form>
								<form
									method="POST"
									action="/admin/respond/{a.id}?action=decline&token={a.response_token}"
									class="action-form"
								>
									<input type="hidden" name="action" value="decline" />
									<input type="hidden" name="token" value={a.response_token} />
									<button type="submit" class="action-btn decline">Decline</button>
								</form>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<h2>
	<button class="toggle" onclick={() => (configOpen = !configOpen)}>
		Config {configOpen ? '▾' : '▸'}
	</button>
</h2>

{#if configOpen}
	<pre class="config-block">{JSON.stringify(data.config, null, 2)}</pre>
{/if}

<style>
	h1 {
		margin: 0 0 4px;
	}

	.signout-form {
		margin-bottom: 32px;
	}

	.links {
		margin: 0 0 24px;
	}

	.links a {
		color: #4f46e5;
		text-decoration: none;
		font-size: 0.875rem;
	}

	.links a:hover {
		text-decoration: underline;
	}

	.signout-form button {
		background: none;
		border: 1px solid #d1d5db;
		border-radius: 6px;
		padding: 4px 12px;
		font-size: 0.8125rem;
		cursor: pointer;
		font-family: inherit;
	}

	.signout-form button:hover {
		background: #f3f4f6;
	}

	h2 {
		font-size: 1.25rem;
		margin: 0 0 12px;
	}

	.empty {
		color: #6b7280;
	}

	.table-wrap {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		text-align: left;
		padding: 8px 12px;
		border-bottom: 1px solid #e5e7eb;
		font-size: 0.875rem;
	}

	th {
		color: #6b7280;
		font-weight: 600;
	}

	.status {
		font-weight: 600;
	}

	.status-confirmed {
		color: #059669;
	}

	.status-pending {
		color: #d97706;
	}

	.status-cancelled {
		color: #9ca3af;
	}

	.status-declined {
		color: #dc2626;
	}

	.notif-warn {
		color: #d97706;
		margin-left: 4px;
		cursor: help;
	}

	.action-form {
		display: inline-block;
		margin-right: 4px;
	}

	.action-btn {
		font-size: 0.8125rem;
		font-weight: 600;
		padding: 3px 10px;
		border-radius: 6px;
		border: 1px solid;
		background: white;
		cursor: pointer;
		font-family: inherit;
	}

	.action-btn.accept {
		color: #059669;
		border-color: #a7f3d0;
	}

	.action-btn.accept:hover {
		background: #ecfdf5;
	}

	.action-btn.decline {
		color: #dc2626;
		border-color: #fca5a5;
	}

	.action-btn.decline:hover {
		background: #fef2f2;
	}

	.toggle {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1.25rem;
		font-weight: 600;
		padding: 0;
		color: #111827;
		font-family: inherit;
	}

	.config-block {
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 16px;
		overflow-x: auto;
		font-size: 0.8125rem;
		line-height: 1.5;
		margin: 0;
	}
</style>
