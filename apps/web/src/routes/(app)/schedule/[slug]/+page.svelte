<script lang="ts">
	import AppointmentWizard from '#lib/components/AppointmentWizard.svelte';

	let { data, form } = $props();
</script>

{#key `${data.eventType.slug}:${data.role}`}
	<AppointmentWizard {data} {form} deepLink />
{/key}
