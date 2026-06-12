<script lang="ts">
	import IconCalendarBlank from 'virtual:icons/ph/calendar-blank';
	import IconWarningCircle from 'virtual:icons/ph/warning-circle';
	import IconLock from 'virtual:icons/ph/lock';
	import IconSignIn from 'virtual:icons/ph/sign-in';

	let { data } = $props();

	// Map error codes to friendly messages
	let errorMessage = $derived.by(() => {
		if (!data.errorCode) return null;
		switch (data.errorCode) {
			case 'CredentialsSignin':
				return 'Invalid username or password. Please try again.';
			case 'SessionRequired':
				return 'Please sign in to access this page.';
			default:
				return 'An authentication error occurred. Please try again.';
		}
	});
</script>

<svelte:head>
	<title>Sign in — When</title>
</svelte:head>

<div class="signin-container">
	<div class="signin-card">
		<header class="signin-header">
			{#if data.branding?.logo_url}
				<img src={data.branding.logo_url} alt="Logo" class="signin-logo" />
			{:else}
				<div class="signin-icon-wrapper">
					<IconCalendarBlank class="signin-icon" aria-hidden="true" />
				</div>
			{/if}
			<h1 class="signin-title">Sign in to When</h1>
			<p class="signin-subtitle">Appointment Scheduling Portal</p>
		</header>

		{#if errorMessage}
			<div class="error-banner" role="alert">
				<IconWarningCircle class="error-icon" aria-hidden="true" />
				<span class="error-text">{errorMessage}</span>
			</div>
		{/if}

		{#if data.authType === 'credentials'}
			<form method="POST" class="signin-form">
				<input type="hidden" name="providerId" value="credentials" />
				<input type="hidden" name="redirectTo" value={data.callbackUrl} />

				<div class="form-group">
					<label for="username" class="form-label">Username</label>
					<div class="input-wrapper">
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

				<button type="submit" class="submit-btn">
					<IconLock class="btn-icon" aria-hidden="true" />
					Sign in
				</button>
			</form>
		{:else if data.authType === 'oidc'}
			<form method="POST" class="signin-form">
				<input type="hidden" name="providerId" value="oidc" />
				<input type="hidden" name="redirectTo" value={data.callbackUrl} />

				<p class="sso-desc">
					This app is configured to use Single Sign-On for authentication.
				</p>

				<button type="submit" class="submit-btn" autofocus>
					<IconSignIn class="btn-icon" aria-hidden="true" />
					Sign in with Single Sign-On
				</button>
			</form>
		{/if}
	</div>
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
		background: var(--surface);
		border: 1px solid var(--border);
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

	.signin-logo {
		width: 48px;
		height: 48px;
		object-fit: contain;
		margin-bottom: var(--space-4);
	}

	.signin-icon-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		background: var(--primary-muted);
		border: 1px solid var(--primary-border);
		border-radius: var(--radius-md);
		margin-bottom: var(--space-4);
		color: var(--primary);
	}

	:global(.signin-icon) {
		font-size: var(--font-size-2xl);
	}

	.signin-title {
		font-size: var(--font-size-xl);
		font-weight: 700;
		color: var(--text);
		margin: 0;
		letter-spacing: -0.01em;
	}

	.signin-subtitle {
		font-size: var(--font-size-sm);
		color: var(--text-muted);
		margin: var(--space-1) 0 0;
	}

	/* ---- error banner ---- */
	.error-banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--danger-bg);
		border: 1px solid var(--danger-border);
		border-radius: var(--radius);
		color: var(--danger);
	}

	:global(.error-icon) {
		font-size: var(--font-size-lg);
		flex-shrink: 0;
		margin-top: 1px;
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
		color: var(--text-secondary);
	}

	.form-input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		font-size: var(--font-size-base);
		font-family: inherit;
		color: var(--text);
		background: var(--surface-page);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		transition: border-color var(--transition), box-shadow var(--transition);
		box-sizing: border-box;
	}

	.form-input::placeholder {
		color: var(--text-muted);
	}

	.form-input:focus {
		outline: none;
		border-color: var(--primary);
		box-shadow: var(--shadow-focus);
		background: var(--surface);
	}

	.submit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-4);
		background: var(--primary);
		color: var(--text-on-primary);
		border: none;
		border-radius: var(--radius);
		font-size: var(--font-size-base);
		font-weight: 600;
		cursor: pointer;
		transition: opacity var(--transition), transform var(--transition);
	}

	.submit-btn:hover {
		opacity: 0.9;
	}

	.submit-btn:active {
		transform: scale(0.98);
	}

	:global(.btn-icon) {
		font-size: var(--font-size-lg);
	}

	.sso-desc {
		font-size: var(--font-size-sm);
		color: var(--text-secondary);
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
