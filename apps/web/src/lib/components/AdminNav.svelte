<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconArrowUpLeft from 'virtual:icons/ph/arrow-up-left';
	import IconSignOut from 'virtual:icons/ph/sign-out';
	import ThemeToggle from './ThemeToggle.svelte';

	// Each admin route renders this nav itself and names its own crumb.
	let { crumb = null }: { crumb?: Snippet | null } = $props();

	let currentPath = $derived(page.url.pathname + page.url.search);
	let pathname = $derived(page.url.pathname);

	let isHome = $derived(pathname === '/admin' || pathname === '/admin/');
	let pending = $state(false);
	let signoutError = $state<'rate' | 'network' | 'auth' | null>(null);

	async function signOut(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;

		const redirectTo = `/signin?callbackUrl=${encodeURIComponent(currentPath)}`;
		pending = true;
		signoutError = null;

		try {
			const { error } = await authClient.signOut();
			if (error) {
				signoutError = error.status === 429 ? 'rate' : 'auth';
				return;
			}
			await goto(redirectTo, { invalidateAll: true });
		} catch {
			signoutError = 'network';
		} finally {
			pending = false;
		}
	}
</script>

<header class="admin-nav">
	<div class="nav-container">
		<nav aria-label="Admin breadcrumb">
			<ol class="breadcrumb">
				<li class="crumb-item">
					<a
						href={isHome ? '/' : '/admin'}
						class="crumb-link"
						aria-label={isHome ? 'Homepage' : 'Admin dashboard'}
					>
						{#if isHome}
							<IconArrowUpLeft aria-hidden="true" />
						{:else}
							<IconCalendarBlank aria-hidden="true" />
						{/if}
					</a>
				</li>
				{#if crumb}
					<li class="crumb-item">
						<span aria-current="page">{@render crumb()}</span>
					</li>
				{/if}
			</ol>
		</nav>
		<div class="nav-actions">
			<ThemeToggle />
			<form
				method="POST"
				class="signout-form"
				aria-label="Sign out"
				aria-busy={pending}
				onsubmit={signOut}
			>
				<button
					type="submit"
					class="logout-btn"
					aria-label={pending ? 'Signing out' : 'Sign out'}
					aria-describedby={signoutError ? 'signout-error' : undefined}
					disabled={pending}
				>
					<IconSignOut aria-hidden="true" />
				</button>
			</form>
		</div>
	</div>
	{#if signoutError}
		<p id="signout-error" class="signout-error" role="alert">
			{#if signoutError === 'rate'}
				Too many requests. Please wait and try signing out again.
			{:else if signoutError === 'network'}
				Unable to connect. Please try signing out again.
			{:else}
				Unable to sign out. Please try again.
			{/if}
		</p>
	{/if}
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

	.nav-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
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
		min-width: calc(var(--space-8) + var(--space-4));
		min-height: calc(var(--space-8) + var(--space-4));
		justify-content: center;
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

	.crumb-item [aria-current='page'] {
		font-size: var(--font-size-md);
		color: var(--color-text-secondary);
	}

	.signout-form {
		margin: 0;
		display: flex;
		align-items: center;
	}

	.signout-error {
		margin: var(--space-2) var(--space-6) 0;
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		text-align: right;
	}

	.logout-btn {
		background: none;
		border: none;
		min-width: calc(var(--space-8) + var(--space-4));
		min-height: calc(var(--space-8) + var(--space-4));
		padding: var(--space-3);
		color: var(--color-text-secondary);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: color var(--transition);
		font-size: var(--font-size-xl);
		border-radius: var(--radius-sm);
	}

	.logout-btn:hover {
		background: var(--color-surface-active);
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
