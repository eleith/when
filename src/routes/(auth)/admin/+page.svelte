<script lang="ts">
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
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	h1 {
		margin: 0 0 4px;
	}

	.signout-form {
		margin-bottom: 32px;
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
</style>
