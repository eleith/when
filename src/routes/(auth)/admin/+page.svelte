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

<form method="POST" action="?/signout" class="signout-form">
	<button type="submit">Sign out</button>
</form>

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
		margin: 0 0 var(--space-2);
	}

	.signout-form {
		margin-bottom: var(--space-8);
	}

	.signout-form button {
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-4);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.signout-form button:hover {
		background: var(--surface-muted);
	}

	h2 {
		font-size: var(--font-size-xl);
		margin: 0 0 var(--space-4);
	}

	.empty {
		color: var(--text-muted);
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
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border);
		font-size: var(--font-size-base);
	}

	th {
		color: var(--text-muted);
		font-weight: 600;
	}

	.status {
		font-weight: 600;
	}

	.status-confirmed {
		color: var(--success);
	}

	.status-pending {
		color: var(--warning);
	}

	.status-cancelled {
		color: var(--text-disabled);
	}

	.status-declined {
		color: var(--danger);
	}

	.notif-warn {
		color: var(--warning);
		margin-left: var(--space-2);
		cursor: help;
	}

	.action-form {
		display: inline-block;
		margin-right: var(--space-2);
	}

	.action-btn {
		font-size: var(--font-size-sm);
		font-weight: 600;
		padding: var(--space-1) var(--space-4);
		border-radius: var(--radius-sm);
		border: 1px solid;
		background: var(--surface);
		cursor: pointer;
	}

	.action-btn.accept {
		color: var(--success);
		border-color: var(--success-border);
	}

	.action-btn.accept:hover {
		background: var(--success-bg);
	}

	.action-btn.decline {
		color: var(--danger);
		border-color: var(--danger-border);
	}

	.action-btn.decline:hover {
		background: var(--danger-bg);
	}

	.toggle {
		background: none;
		border: none;
		cursor: pointer;
		font-size: var(--font-size-xl);
		font-weight: 600;
		padding: 0;
		color: var(--text);
	}

	.config-block {
		background: var(--surface-page);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: var(--space-5);
		overflow-x: auto;
		font-size: var(--font-size-sm);
		line-height: 1.5;
		margin: 0;
	}
</style>
