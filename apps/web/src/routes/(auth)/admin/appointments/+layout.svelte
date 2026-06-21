<script lang="ts">
	import { page } from '$app/state';
	import IconWarning from 'virtual:icons/ph/warning';
	import IconCaretLeft from 'virtual:icons/ph/caret-left';
	import IconCaretRight from 'virtual:icons/ph/caret-right';

	let { data, children } = $props();

	let currentPath = $derived(page.url.pathname);
	let badCalendars = $derived(data.calendars.filter((c) => c.health === 'bad'));

	let currentPage = $derived(page.data.page ?? 1);
	let pageCount = $derived(page.data.pageCount ?? 1);
	let prevHref = $derived(currentPage > 1 ? `?page=${currentPage - 1}` : null);
	let nextHref = $derived(currentPage < pageCount ? `?page=${currentPage + 1}` : null);
</script>

<div class="appointments-layout">
	{#if data.conflictCount > 0}
		<div class="review-banner" role="alert">
			<IconWarning class="review-icon" aria-hidden="true" />
			<span>
				{data.conflictCount} possible conflict{#if data.conflictCount !== 1}s{/if} — please review.
			</span>
		</div>
	{/if}

	{#if badCalendars.length > 0}
		<div class="review-banner" role="alert">
			<IconWarning class="review-icon" aria-hidden="true" />
			<div class="health-banner-body">
				<strong>Calendar sync problem.</strong>
				<ul class="health-list">
					{#each badCalendars as c (c.id)}
						<li><span class="health-cal">{c.id}</span> — {c.reason ?? 'not syncing'}</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}

	<div class="card appointments-card">
		<div class="card-header">
			<div class="tabs-strip">
				<a
					href="/admin/appointments/upcoming"
					class="sub-tab"
					class:active={currentPath === '/admin/appointments/upcoming'}
				>
					Upcoming
					{#if data.upcomingCount > 0}
						<span class="tab-badge">{data.upcomingCount}</span>
					{/if}
				</a>
				<a
					href="/admin/appointments/pending"
					class="sub-tab"
					class:active={currentPath === '/admin/appointments/pending'}
				>
					Pending
					{#if data.pendingCount > 0}
						<span class="tab-badge tab-badge-pending">{data.pendingCount}</span>
					{/if}
				</a>
				<a
					href="/admin/appointments/concluded"
					class="sub-tab"
					class:active={currentPath === '/admin/appointments/concluded'}
				>
					Concluded
				</a>
				<a
					href="/admin/appointments/archived"
					class="sub-tab"
					class:active={currentPath === '/admin/appointments/archived'}
				>
					Archived
				</a>
				<a
					href="/admin/appointments/purged"
					class="sub-tab"
					class:active={currentPath === '/admin/appointments/purged'}
				>
					Purged
				</a>
			</div>
		</div>

		<div class="card-content">
			{@render children()}
		</div>

		{#if pageCount > 1}
			<div class="card-footer">
				<div class="pagination">
					{#if prevHref}
						<a href={prevHref} class="pagination-link" aria-label="Previous page">
							<IconCaretLeft aria-hidden="true" />
						</a>
					{:else}
						<span class="pagination-link disabled" aria-label="Previous page">
							<IconCaretLeft aria-hidden="true" />
						</span>
					{/if}
					{#if nextHref}
						<a href={nextHref} class="pagination-link" aria-label="Next page">
							<IconCaretRight aria-hidden="true" />
						</a>
					{:else}
						<span class="pagination-link disabled" aria-label="Next page">
							<IconCaretRight aria-hidden="true" />
						</span>
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.appointments-layout {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* ---- card styling ---- */
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.card-header {
		background: var(--surface-page);
		border-bottom: 1px solid var(--border);
		padding: 0 var(--space-2);
	}

	.card-content {
		background: var(--surface);
	}

	.card-footer {
		background: var(--surface-page);
		border-top: 1px solid var(--border);
		padding: var(--space-3) var(--space-5);
	}

	/* ---- sub-tabs (underline style flush to header bottom) ---- */
	.tabs-strip {
		display: flex;
		gap: var(--space-2);
	}

	.sub-tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--text-muted);
		text-decoration: none;
		padding: var(--space-4) var(--space-3);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition:
			border-color var(--transition),
			color var(--transition);
	}

	.sub-tab:hover {
		color: var(--text);
	}

	.sub-tab.active {
		color: var(--text);
		border-bottom-color: var(--primary);
	}

	.tab-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
		font-size: var(--font-size-sm);
		font-weight: 700;
		border-radius: var(--radius-pill);
		background: var(--surface-active);
		color: var(--text-secondary);
		line-height: 1;
	}

	.tab-badge-pending {
		background: var(--warning-bg);
		color: var(--warning-strong);
	}

	/* ---- pagination (clean text links with arrows) ---- */
	.pagination {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	.pagination-link {
		color: var(--text-secondary);
		text-decoration: none;
		transition: color var(--transition);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		font-size: var(--font-size-xl);
	}

	.pagination-link:not(.disabled):hover {
		color: var(--text);
	}

	.pagination-link.disabled {
		color: var(--text-disabled);
		cursor: not-allowed;
	}

	/* ---- review banner ---- */
	.review-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--warning) 12%, transparent);
		color: var(--warning);
		font-weight: 600;
		font-size: var(--font-size-sm);
	}

	.review-banner:has(.health-banner-body) {
		align-items: flex-start;
	}

	.health-banner-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.health-list {
		margin: 0;
		padding-left: var(--space-4);
		font-weight: 500;
	}

	.health-cal {
		font-weight: 700;
	}
</style>
