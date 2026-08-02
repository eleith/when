<script lang="ts">
	import AdminNav from '$lib/components/AdminNav.svelte';
	import AppointmentWizard from '$lib/components/AppointmentWizard.svelte';

	let { data, form } = $props();
</script>

{#if data.isAdmin}
	<AdminNav />
{/if}

<AppointmentWizard {data} {form} deepLink />
