<script lang="ts">
	import AppointmentsList from '$lib/components/AppointmentsList.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Archived Appointments — When</title>
</svelte:head>

{#if data.appointments.length === 0}
	<div class="empty-state">
		<p class="empty-text">No archived appointments.</p>
	</div>
{:else}
	<AppointmentsList appointments={data.appointments} bucket="archived" />
{/if}

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-10) var(--space-6);
		text-align: center;
	}

	.empty-text {
		font-size: var(--font-size-md);
		color: var(--color-text-muted);
		margin: 0;
	}
</style>
