<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Sign in — When</title>
</svelte:head>

<h1>Sign in</h1>

<form method="POST" action="/auth/callback/credentials">
	<input type="hidden" name="csrfToken" value={data.csrfToken} />
	<input type="hidden" name="callbackUrl" value={data.callbackUrl} />
	<label>
		Username
		<input name="username" autocomplete="username" required />
	</label>
	<label>
		Password
		<input name="password" type="password" autocomplete="current-password" required />
	</label>
	<button type="submit">Sign in</button>
</form>
