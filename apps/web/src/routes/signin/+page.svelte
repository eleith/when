<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconLock from 'virtual:icons/ph/lock';
	import IconSignIn from 'virtual:icons/ph/sign-in';

	let { data } = $props();

	let pending = $state(false);
	let submitError = $state<string | null>(null);
	let errorCode = $derived(submitError ?? data.errorCode);

	async function signIn(event: SubmitEvent) {
		event.preventDefault();
		if (pending) return;

		const formData = new FormData(event.currentTarget as HTMLFormElement);
		pending = true;
		submitError = null;

		try {
			if (data.auth.type === 'oidc') {
				const { error } = await authClient.signIn.social({
					provider: 'oidc',
					callbackURL: data.callbackUrl,
					errorCallbackURL: `/signin?callbackUrl=${encodeURIComponent(data.callbackUrl)}`
				});
				if (error) {
					submitError = error.status === 429 ? 'RateLimited' : 'AuthError';
					pending = false;
				}
				return;
			}

			const { error } = await authClient.$fetch('/sign-in/credentials', {
				method: 'POST',
				body: {
					username: formData.get('username'),
					password: formData.get('password')
				}
			});
			if (error) {
				if (error.status === 401) submitError = 'CredentialsSignin';
				else if (error.status === 429) submitError = 'RateLimited';
				else submitError = 'AuthError';
				pending = false;
				return;
			}
			await goto(data.callbackUrl, { invalidateAll: true });
		} catch {
			submitError = 'NetworkError';
			pending = false;
		}
	}
</script>

<svelte:head>
	<title>Sign in — When</title>
</svelte:head>

<svelte:window
	onpageshow={(event) => {
		if (event.persisted) pending = false;
	}}
/>

<div class="signin-container">
	<main class="signin-card">
		<header class="signin-header">
			<img src={data.appearance.app_icon_path} alt="" class="signin-icon" />
			<h1 class="signin-title">Sign in to When</h1>
			<p class="signin-subtitle">Appointment Scheduling Portal</p>
		</header>

		{#if errorCode}
			<div class="error-banner" role="alert">
				<span class="error-icon"><IconWarningCircle aria-hidden="true" /></span>
				<span class="error-text">
					{#if errorCode === 'CredentialsSignin'}
						Invalid username or password. Please try again.
					{:else if errorCode === 'SessionRequired'}
						Please sign in to access this page.
					{:else if errorCode === 'RateLimited'}
						Too many sign-in attempts. Please wait and try again.
					{:else if errorCode === 'NetworkError'}
						Unable to connect. Please try again.
					{:else}
						An authentication error occurred. Please try again.
					{/if}
				</span>
			</div>
		{/if}

		{#if data.auth.type === 'credentials'}
			<form method="POST" class="signin-form" onsubmit={signIn} aria-busy={pending}>
				<div class="form-group">
					<label for="username" class="form-label">Username</label>
					<div class="input-wrapper">
						<!-- svelte-ignore a11y_autofocus -->
						<input
							id="username"
							name="username"
							type="text"
							autocomplete="username"
							placeholder="Enter your username"
							required
							autofocus
							class="form-input"
						/>
					</div>
				</div>

				<div class="form-group">
					<label for="password" class="form-label">Password</label>
					<div class="input-wrapper">
						<input
							id="password"
							name="password"
							type="password"
							autocomplete="current-password"
							placeholder="Enter your password"
							required
							class="form-input"
						/>
					</div>
				</div>

				<button type="submit" class="submit-btn" disabled={pending}>
					<span class="btn-icon"><IconLock aria-hidden="true" /></span>
					{#if pending}
						Signing in…
					{:else}
						Sign in
					{/if}
				</button>
			</form>
		{:else if data.auth.type === 'oidc'}
			<form method="POST" class="signin-form" onsubmit={signIn} aria-busy={pending}>
				<p class="sso-desc">
					Single sign-on via {data.auth.name}.
				</p>

				<!-- svelte-ignore a11y_autofocus -->
				<button type="submit" class="submit-btn" autofocus disabled={pending}>
					<span class="btn-icon"><IconSignIn aria-hidden="true" /></span>
					{#if pending}
						Signing in…
					{:else}
						Sign in
					{/if}
				</button>
			</form>
		{/if}
	</main>
</div>

<style>
	.signin-container {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 80vh;
		padding: var(--space-6) var(--space-4);
	}

	.signin-card {
		width: 100%;
		max-width: 400px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		padding: var(--space-8);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		animation: fade-in 0.3s ease-out;
	}

	.signin-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.signin-icon {
		width: 48px;
		height: 48px;
		object-fit: contain;
		margin-bottom: var(--space-4);
	}

	.signin-title {
		font-size: var(--font-size-xl);
		font-weight: 700;
		color: var(--when-color-text);
		margin: 0;
		letter-spacing: -0.01em;
	}

	.signin-subtitle {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}

	/* ---- error banner ---- */
	.error-banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-danger-bg);
		border: 1px solid var(--color-danger-border);
		border-radius: var(--radius);
		color: var(--color-danger);
	}

	.error-icon {
		font-size: var(--font-size-lg);
		flex-shrink: 0;
		margin-top: 1px;
		display: inline-flex;
	}

	.error-text {
		font-size: var(--font-size-sm);
		line-height: 1.4;
	}

	/* ---- form styling ---- */
	.signin-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.form-label {
		font-size: var(--font-size-sm);
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.form-input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		font-size: var(--font-size-base);
		font-family: inherit;
		color: var(--when-color-text);
		background: var(--when-color-surface-page);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius);
		transition:
			border-color var(--transition),
			box-shadow var(--transition);
		box-sizing: border-box;
	}

	.form-input::placeholder {
		color: var(--color-text-muted);
	}

	.form-input:focus {
		outline: none;
		border-color: var(--when-color-primary);
		box-shadow: var(--shadow-focus);
		background: var(--color-surface);
	}

	.submit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-4);
		background: var(--when-color-primary);
		color: var(--when-color-text-on-primary);
		border: none;
		border-radius: var(--radius);
		font-size: var(--font-size-base);
		font-weight: 600;
		cursor: pointer;
		transition:
			opacity var(--transition),
			transform var(--transition);
	}

	.submit-btn:hover {
		opacity: 0.9;
	}

	.submit-btn:active {
		transform: scale(0.98);
	}

	.btn-icon {
		font-size: var(--font-size-lg);
		display: inline-flex;
	}

	.sso-desc {
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		line-height: 1.5;
		text-align: center;
		margin: 0 0 var(--space-2);
	}

	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 480px) {
		.signin-card {
			padding: var(--space-6);
			border: none;
			box-shadow: none;
			background: transparent;
		}

		.signin-container {
			align-items: flex-start;
			padding-top: var(--space-10);
		}
	}
</style>
