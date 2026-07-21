<script lang="ts">
	import { page } from '$app/state';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconSignOut from 'virtual:icons/ph/sign-out';

	let currentPath = $derived(page.url.pathname + page.url.search);
	let pathname = $derived(page.url.pathname);

	let isHome = $derived(pathname === '/admin' || pathname === '/admin/');

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

	let homeHref = $derived(isHome ? null : '/admin');
</script>

<header class="admin-nav">
	<div class="nav-container">
		<nav aria-label="Admin breadcrumb">
			<ol class="breadcrumb">
				<li class="crumb-item">
					{#if homeHref}
						<a href={homeHref} class="crumb-link" aria-label="Admin dashboard">
							<IconCalendarBlank aria-hidden="true" />
							<span class="crumb-label">Admin</span>
						</a>
					{:else}
						<span class="crumb-root">
							<IconCalendarBlank aria-hidden="true" />
							<span class="crumb-label">Admin</span>
						</span>
					{/if}
				</li>
				{#if currentCrumb}
					<li class="crumb-item">
						<span aria-current="page">{currentCrumb}</span>
					</li>
				{/if}
			</ol>
		</nav>
		<form method="POST" action="/admin?/signout" class="signout-form" aria-label="Sign out">
			<input
				type="hidden"
				name="redirectTo"
				value="/signin?callbackUrl={encodeURIComponent(currentPath)}"
			/>
			<button type="submit" class="logout-btn">
				<IconSignOut aria-hidden="true" />
				<span class="crumb-label">Logout</span>
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
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.crumb-item {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	.crumb-item + .crumb-item::before {
		content: '';
		display: inline-block;
		width: 1em;
		height: 1em;
		background-color: var(--color-text-disabled);
		mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='currentColor' d='m181.66 133.66l-80 80a8 8 0 0 1-11.32-11.32L164.69 128L90.34 53.66a8 8 0 0 1 11.32-11.32l80 80a8 8 0 0 1 0 11.32Z'/%3E%3C/svg%3E")
			center / contain no-repeat;
		font-size: var(--font-size-md);
		flex-shrink: 0;
	}

	.crumb-link {
		color: var(--color-text-secondary);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		transition: color var(--transition);
		font-size: var(--font-size-xl);
		border-radius: var(--radius-sm);
	}

	.crumb-link:hover {
		color: var(--when-color-text);
	}

	.crumb-link:focus-visible {
		outline: 2px solid var(--when-color-primary);
		outline-offset: 2px;
	}

	.crumb-root {
		color: var(--color-text-muted);
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-xl);
	}

	.crumb-label {
		font-size: var(--font-size-md);
		font-weight: 500;
	}

	.crumb-item [aria-current='page'] {
		font-size: var(--font-size-md);
		color: var(--color-text-secondary);
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
		color: var(--color-text-secondary);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		transition: color var(--transition);
		font-size: var(--font-size-xl);
		border-radius: var(--radius-sm);
	}

	.logout-btn:hover {
		color: var(--when-color-text);
	}

	.logout-btn:focus-visible {
		outline: 2px solid var(--when-color-primary);
		outline-offset: 2px;
	}

	@media (max-width: 768px) {
		.nav-container {
			padding: 0 var(--space-4);
		}
	}
</style>
