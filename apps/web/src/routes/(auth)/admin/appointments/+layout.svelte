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
		<h1 class="visibility-hidden">When Admin</h1>
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
							<span>Previous</span>
						</a>
					{:else}
						<span class="pagination-link disabled">
							<IconCaretLeft aria-hidden="true" />
							<span>Previous</span>
						</span>
					{/if}
					{#if nextHref}
						<a href={nextHref} class="pagination-link" aria-label="Next page">
							<span>Next</span>
							<IconCaretRight aria-hidden="true" />
						</a>
					{:else}
						<span class="pagination-link disabled">
							<span>Next</span>
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

	.card {
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.card-header {
		background: var(--when-color-surface-page);
	}

	.card-content {
		background: var(--color-surface);
	}

	.card-footer {
		background: var(--when-color-surface-page);
		border-top: 1px solid var(--color-border);
		padding: var(--space-3) var(--space-5);
	}

	/* ---- sub-tabs (underline style flush to header bottom) ---- */
	/* The hairline and padding live here rather than on .card-header so the strip can
	   scroll horizontally: an overflow-x container clips the y axis too, which would eat
	   the underline a negative margin used to hang over the header's border. */
	.tabs-strip {
		display: flex;
		flex-wrap: nowrap;
		gap: var(--space-2);
		padding: 0 var(--space-2);
		border-bottom: 1px solid var(--color-border);
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x proximity;
		scrollbar-width: none;
	}

	.tabs-strip::-webkit-scrollbar {
		display: none;
	}

	.sub-tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
		white-space: nowrap;
		scroll-snap-align: start;
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--color-text-muted);
		text-decoration: none;
		padding: var(--space-4) var(--space-3);
		border-bottom: 2px solid transparent;
		transition:
			border-color var(--transition),
			color var(--transition);
	}

	.sub-tab:hover {
		color: var(--when-color-text);
	}

	.sub-tab.active {
		color: var(--when-color-text);
		border-bottom-color: var(--when-color-primary);
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
		background: var(--color-surface-active);
		color: var(--color-text-secondary);
		line-height: 1;
	}

	.tab-badge-pending {
		background: var(--color-warning-bg);
		color: var(--color-warning-strong);
	}

	/* ---- pagination (clean text links with arrows) ---- */
	.pagination {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	.pagination-link {
		color: var(--color-text-secondary);
		text-decoration: none;
		transition: color var(--transition);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-width: 44px;
		min-height: 44px;
		padding: 0 var(--space-2);
		font-size: var(--font-size-md);
		font-weight: 600;
	}

	.pagination-link :global(svg) {
		font-size: var(--font-size-xl);
	}

	.pagination-link:not(.disabled):hover {
		color: var(--when-color-text);
	}

	.pagination-link.disabled {
		color: var(--color-text-disabled);
		cursor: not-allowed;
	}

	/* ---- review banner ---- */
	.review-banner {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-warning) 12%, transparent);
		color: var(--color-warning);
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
