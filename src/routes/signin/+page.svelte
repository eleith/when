<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Sign in — When</title>
</svelte:head>

<h1>Sign in</h1>

<form method="POST">
	<input type="hidden" name="providerId" value="credentials" />
	<input type="hidden" name="redirectTo" value={data.callbackUrl} />
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
