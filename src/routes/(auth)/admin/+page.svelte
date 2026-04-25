<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>Admin — When</title>
</svelte:head>

<h1>Admin</h1>
<p>Signed in as {data.session.user?.name ?? 'unknown'}</p>

<form method="POST" action="/auth/signout">
	<input type="hidden" name="csrfToken" value={data.csrfToken} />
	<button type="submit">Sign out</button>
</form>
