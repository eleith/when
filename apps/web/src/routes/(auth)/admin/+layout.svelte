<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	let currentPath = $derived(page.url.pathname);
</script>

<div class="admin-container">
	<header class="admin-header">
		<div class="header-left">
			<a href="/admin" class="brand-logo">Admin</a>
			<nav class="nav-tabs">
				<a href="/admin" class="nav-tab" class:active={currentPath === '/admin'}>Bookings</a>
				<a href="/admin/config" class="nav-tab" class:active={currentPath === '/admin/config'}
					>Config</a
				>
			</nav>
		</div>
		<form method="POST" action="/admin?/signout" class="signout-form">
			<button type="submit" class="logout-btn">logout</button>
		</form>
	</header>

	<main class="admin-main">
		{@render children()}
	</main>
</div>

<style>
	.admin-container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 0 var(--space-6) var(--space-10);
		color: var(--text);
	}

	/* ---- header navigation ---- */
	.admin-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-5) 0;
		border-bottom: 1px solid var(--border);
		margin-bottom: var(--space-8);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-8);
	}

	.brand-logo {
		font-size: var(--font-size-xl);
		font-weight: 800;
		letter-spacing: -0.025em;
		color: var(--text);
		text-decoration: none;
	}

	.nav-tabs {
		display: flex;
		gap: var(--space-5);
	}

	.nav-tab {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text-muted);
		text-decoration: none;
		padding: var(--space-2) 0;
		border-bottom: 2px solid transparent;
		transition:
			color var(--transition),
			border-color var(--transition);
	}

	.nav-tab:hover {
		color: var(--text);
	}

	.nav-tab.active {
		color: var(--primary);
		border-bottom-color: var(--primary);
	}

	.signout-form {
		margin: 0;
	}

	.logout-btn {
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-4);
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--text-secondary);
		cursor: pointer;
		text-transform: lowercase;
		transition:
			background var(--transition),
			border-color var(--transition),
			color var(--transition);
	}

	.logout-btn:hover {
		background: var(--surface-muted);
		border-color: var(--text-muted);
		color: var(--text);
	}

	.admin-main {
		display: flex;
		flex-direction: column;
	}

	@media (max-width: 768px) {
		.admin-container {
			padding: 0 var(--space-4) var(--space-8);
		}

		.admin-header {
			margin-bottom: var(--space-6);
		}

		.header-left {
			gap: var(--space-4);
		}
	}
</style>
