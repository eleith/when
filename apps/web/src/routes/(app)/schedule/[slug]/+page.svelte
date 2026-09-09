<script lang="ts">
	import AppointmentWizard from '$lib/components/AppointmentWizard.svelte';

	let { data, form } = $props();
</script>

<AppointmentWizard {data} {form} deepLink />
