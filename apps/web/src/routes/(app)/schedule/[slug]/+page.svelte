<script lang="ts">
	import BookingWizard from '$lib/components/BookingWizard.svelte';

	let { data, form } = $props();
</script>

<BookingWizard {data} {form} deepLink />
