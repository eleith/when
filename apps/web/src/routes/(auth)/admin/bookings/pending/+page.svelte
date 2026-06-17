<script lang="ts">
	import BookingsTable from '$lib/components/BookingsTable.svelte';

	let { data } = $props();

	let prevHref = $derived(data.page > 1 ? `?page=${data.page - 1}` : null);
	let nextHref = $derived(data.page < data.pageCount ? `?page=${data.page + 1}` : null);
</script>

<svelte:head>
	<title>Pending Bookings — When</title>
</svelte:head>

{#if data.appointments.length === 0}
	<div class="card empty-card">
		<p class="empty-text">No pending appointments.</p>
	</div>
{:else}
	<BookingsTable appointments={data.appointments} />

	{#if data.pageCount > 1}
		<div class="pagination">
			{#if prevHref}
				<a href={prevHref} class="pagination-link">Prev</a>
			{:else}
				<span class="pagination-link disabled">Prev</span>
			{/if}
			{#if nextHref}
				<a href={nextHref} class="pagination-link">Next</a>
			{:else}
				<span class="pagination-link disabled">Next</span>
			{/if}
		</div>
	{/if}
{/if}

<style>
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
	}

	.empty-text {
		font-size: var(--font-size-md);
		color: var(--text-muted);
		margin: 0;
	}

	.pagination {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}

	.pagination-link {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text);
		text-decoration: none;
		padding: var(--space-2) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		transition: background var(--transition);
	}

	.pagination-link:not(.disabled):hover {
		background: var(--surface-muted);
	}

	.pagination-link.disabled {
		color: var(--text-disabled);
		border-color: var(--border-muted, var(--border));
		cursor: not-allowed;
	}
</style>
