<script lang="ts">
	import { page } from '$app/state';
	import AppointmentWizard from '#lib/components/AppointmentWizard.svelte';

	let { data, form } = $props();
</script>

{#key `${page.params.id}:${data.role}`}
	<AppointmentWizard {data} {form} />
{/key}
