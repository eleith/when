<script lang="ts">
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
	<main class="signin-card">
		<header class="signin-header">
			<img src={data.appearance.app_icon_url} alt="" class="signin-icon" />
			<h1 class="signin-title">Sign in to When</h1>
			<p class="signin-subtitle">Appointment Scheduling Portal</p>
		</header>

		{#if errorMessage}
			<div class="error-banner" role="alert">
				<span class="error-icon"><IconWarningCircle aria-hidden="true" /></span>
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

				<button type="submit" class="submit-btn">
					<span class="btn-icon"><IconLock aria-hidden="true" /></span>
					Sign in
				</button>
			</form>
		{:else if data.authType === 'oidc'}
			<form method="POST" class="signin-form">
				<input type="hidden" name="providerId" value="oidc" />
				<input type="hidden" name="redirectTo" value={data.callbackUrl} />

				<p class="sso-desc">This app is configured to use Single Sign-On for authentication.</p>

				<!-- svelte-ignore a11y_autofocus -->
				<button type="submit" class="submit-btn" autofocus>
					<span class="btn-icon"><IconSignIn aria-hidden="true" /></span>
					Sign in with Single Sign-On
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
		color: var(--text-secondary);
	}

	.form-input {
		width: 100%;
		padding: var(--space-3) var(--space-4);
		font-size: var(--font-size-base);
		font-family: inherit;
		color: var(--when-color-text);
		background: var(--when-color-surface-page);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		transition:
			border-color var(--transition),
			box-shadow var(--transition);
		box-sizing: border-box;
	}

	.form-input::placeholder {
		color: var(--text-muted);
	}

	.form-input:focus {
		outline: none;
		border-color: var(--when-color-primary);
		box-shadow: var(--shadow-focus);
		background: var(--surface);
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
