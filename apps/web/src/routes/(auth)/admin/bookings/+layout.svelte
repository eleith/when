<script lang="ts">
	import { page } from '$app/state';
	import IconWarning from 'virtual:icons/ph/warning';

	let { data, children } = $props();

	let currentPath = $derived(page.url.pathname);
	let badCalendars = $derived(data.calendars.filter((c: any) => c.health === 'bad'));
</script>

<div class="bookings-layout">
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

	<div class="tabs-strip">
		<a
			href="/admin/bookings/upcoming"
			class="sub-tab"
			class:active={currentPath === '/admin/bookings/upcoming'}
		>
			Upcoming
			{#if data.upcomingCount > 0}
				<span class="tab-badge">{data.upcomingCount}</span>
			{/if}
		</a>
		<a
			href="/admin/bookings/pending"
			class="sub-tab"
			class:active={currentPath === '/admin/bookings/pending'}
		>
			Pending
			{#if data.pendingCount > 0}
				<span class="tab-badge tab-badge-pending">{data.pendingCount}</span>
			{/if}
		</a>
		<a
			href="/admin/bookings/concluded"
			class="sub-tab"
			class:active={currentPath === '/admin/bookings/concluded'}
		>
			Concluded
		</a>
		<a
			href="/admin/bookings/archived"
			class="sub-tab"
			class:active={currentPath === '/admin/bookings/archived'}
		>
			Archived
		</a>
	</div>

	<div class="bookings-content">
		{@render children()}
	</div>
</div>

<style>
	.bookings-layout {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.tabs-strip {
		display: flex;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.sub-tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-base);
		font-weight: 600;
		color: var(--text-muted);
		text-decoration: none;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		transition:
			background var(--transition),
			color var(--transition);
	}

	.sub-tab:hover {
		color: var(--text);
		background: var(--surface-muted);
	}

	.sub-tab.active {
		color: var(--text);
		background: var(--surface-active);
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
