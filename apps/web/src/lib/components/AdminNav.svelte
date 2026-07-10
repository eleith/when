<script lang="ts">
	import { page } from '$app/state';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconCaretRight from 'virtual:icons/ph/caret-right';
	import IconSignOut from 'virtual:icons/ph/sign-out';

	let currentPath = $derived(page.url.pathname + page.url.search);
	let pathname = $derived(page.url.pathname);

	let isHome = $derived(pathname === '/admin/appointments/upcoming');

	const TAB_LABELS: Record<string, string> = {
		upcoming: 'Upcoming',
		pending: 'Pending',
		concluded: 'Concluded',
		archived: 'Archived',
		purged: 'Purged'
	};

	let currentCrumb = $derived.by(() => {
		const match = pathname.match(/^\/admin\/appointments\/(\w+)/);
		if (match && match[1] in TAB_LABELS) return TAB_LABELS[match[1]];
		return null;
	});

	let homeHref = $derived(isHome ? null : '/admin/appointments/upcoming');
</script>

<header class="admin-nav">
	<div class="nav-container">
		<nav class="breadcrumb" aria-label="Breadcrumb">
			{#if homeHref}
				<a href={homeHref} class="nav-link" aria-label="Admin dashboard">
					<IconCalendarBlank aria-hidden="true" />
					<span class="nav-label">Admin</span>
				</a>
			{:else}
				<span class="nav-icon">
					<IconCalendarBlank aria-hidden="true" />
					<span class="nav-label">Admin</span>
				</span>
			{/if}
			{#if currentCrumb}
				<span class="separator"><IconCaretRight aria-hidden="true" /></span>
				<span class="crumb-current">{currentCrumb}</span>
			{/if}
		</nav>
		<form method="POST" action="/admin?/signout" class="signout-form">
			<input
				type="hidden"
				name="redirectTo"
				value="/signin?callbackUrl={encodeURIComponent(currentPath)}"
			/>
			<button type="submit" class="logout-btn" aria-label="Log out">
				<IconSignOut aria-hidden="true" />
				<span class="nav-label">Logout</span>
			</button>
		</form>
	</div>
</header>

<style>
	.admin-nav {
		width: 100%;
		background: transparent;
		padding: var(--space-5) 0;
	}

	.nav-container {
		width: 100%;
		padding: 0 var(--space-6);
		display: flex;
		justify-content: space-between;
		align-items: center;
		box-sizing: border-box;
	}

	.breadcrumb {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.nav-link {
		color: var(--text-secondary);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		transition: color var(--transition);
		font-size: var(--font-size-xl);
	}

	.nav-link:hover {
		color: var(--text);
	}

	.nav-link:hover .nav-label {
		color: var(--text);
	}

	.nav-label {
		font-size: var(--font-size-md);
		font-weight: 500;
	}

	.nav-icon {
		color: var(--text-muted);
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-xl);
	}

	.nav-icon .nav-label {
		font-size: var(--font-size-md);
		font-weight: 500;
		color: var(--text-muted);
	}

	.separator {
		color: var(--text-disabled);
		font-size: var(--font-size-md);
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}

	.crumb-current {
		font-size: var(--font-size-md);
		color: var(--text-secondary);
	}

	.signout-form {
		margin: 0;
		display: flex;
		align-items: center;
	}

	.logout-btn {
		background: none;
		border: none;
		padding: 0;
		color: var(--text-secondary);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		transition: color var(--transition);
		font-size: var(--font-size-xl);
	}

	.logout-btn:hover {
		color: var(--text);
	}

	.logout-btn:hover .nav-label {
		color: var(--text);
	}

	@media (max-width: 768px) {
		.nav-container {
			padding: 0 var(--space-4);
		}
	}
</style>
