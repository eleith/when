<script lang="ts">
	let { data, form } = $props();
</script>

<svelte:head>
	<title>Availability overrides — When</title>
</svelte:head>

<p class="back"><a href="/admin">&larr; Back to admin</a></p>

<h1>Availability overrides</h1>

<p class="hint">
	Block specific dates or replace a day's hours. Leave start &amp; end blank to block the day
	entirely.
</p>

{#if form?.error}
	<p class="error">{form.error}</p>
{/if}

<form method="POST" action="?/add" class="add-form">
	<label>
		Date
		<input type="date" name="date" required />
	</label>
	<label>
		Start
		<input type="time" name="start_time" />
	</label>
	<label>
		End
		<input type="time" name="end_time" />
	</label>
	<label class="reason">
		Reason (optional)
		<input type="text" name="reason" maxlength="200" />
	</label>
	<button type="submit">Add override</button>
</form>

<h2>Current overrides</h2>

{#if data.overrides.length === 0}
	<p class="empty">No overrides set.</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th>Date</th>
					<th>Hours</th>
					<th>Reason</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.overrides as o (o.id)}
					<tr>
						<td>{o.date}</td>
						<td>
							{#if o.start_time && o.end_time}
								{o.start_time} &ndash; {o.end_time}
							{:else}
								<span class="block">All-day block</span>
							{/if}
						</td>
						<td>{o.reason ?? ''}</td>
						<td>
							<form method="POST" action="?/delete" class="del-form">
								<input type="hidden" name="id" value={o.id} />
								<button type="submit" class="del-btn">Delete</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.back {
		margin: 0 0 16px;
	}

	.back a {
		color: #4f46e5;
		text-decoration: none;
		font-size: 0.875rem;
	}

	h1 {
		margin: 0 0 4px;
	}

	.hint {
		color: #6b7280;
		font-size: 0.875rem;
		margin: 0 0 16px;
	}

	.error {
		color: #b91c1c;
		background: #fef2f2;
		border: 1px solid #fca5a5;
		border-radius: 6px;
		padding: 8px 12px;
		margin: 0 0 16px;
		font-size: 0.875rem;
	}

	.add-form {
		display: grid;
		grid-template-columns: repeat(4, auto) 1fr auto;
		gap: 12px;
		align-items: end;
		margin-bottom: 32px;
		padding: 16px;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
	}

	.add-form label {
		display: flex;
		flex-direction: column;
		font-size: 0.8125rem;
		color: #374151;
		font-weight: 600;
	}

	.add-form input {
		margin-top: 4px;
		padding: 6px 8px;
		border: 1px solid #d1d5db;
		border-radius: 4px;
		font-family: inherit;
		font-size: 0.875rem;
	}

	.add-form .reason input {
		width: 100%;
	}

	.add-form button {
		padding: 8px 16px;
		border: 1px solid #4f46e5;
		background: #4f46e5;
		color: white;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
	}

	.add-form button:hover {
		background: #4338ca;
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

	.block {
		color: #b45309;
		font-weight: 600;
	}

	.del-form {
		margin: 0;
	}

	.del-btn {
		background: none;
		border: 1px solid #fca5a5;
		color: #dc2626;
		padding: 3px 10px;
		border-radius: 6px;
		font-size: 0.8125rem;
		cursor: pointer;
		font-family: inherit;
	}

	.del-btn:hover {
		background: #fef2f2;
	}
</style>
