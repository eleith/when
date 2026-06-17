<script lang="ts">
	import { page } from '$app/state';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconSignOut from 'virtual:icons/ph/sign-out';

	let currentPath = $derived(page.url.pathname + page.url.search);
</script>

<header class="admin-nav">
	<div class="nav-container">
		<a href="/admin/bookings/upcoming" class="nav-link" aria-label="Bookings dashboard">
			<IconCalendarBlank class="nav-icon" aria-hidden="true" />
		</a>
		<form method="POST" action="/admin?/signout" class="signout-form">
			<input
				type="hidden"
				name="redirectTo"
				value="/signin?callbackUrl={encodeURIComponent(currentPath)}"
			/>
			<button type="submit" class="logout-btn" aria-label="Log out">
				<IconSignOut class="nav-icon" aria-hidden="true" />
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

	.nav-link {
		color: var(--text-secondary);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: color var(--transition);
	}

	.nav-link:hover {
		color: var(--text);
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
		justify-content: center;
		transition: color var(--transition);
	}

	.logout-btn:hover {
		color: var(--text);
	}

	:global(.nav-icon) {
		font-size: var(--font-size-2xl);
		display: block;
	}

	@media (max-width: 768px) {
		.nav-container {
			padding: 0 var(--space-4);
		}
	}
</style>
