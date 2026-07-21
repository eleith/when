<script lang="ts">
	import AppointmentsTable from '$lib/components/AppointmentsTable.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Purged Appointments — When</title>
</svelte:head>

{#if data.appointments.length === 0}
	<div class="empty-state">
		<p class="empty-text">No purged appointments.</p>
	</div>
{:else}
	<p class="purged-note">These appointments are being deleted in the background.</p>
	<AppointmentsTable appointments={data.appointments} bucket="purged" />
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

	.purged-note {
		margin: 0;
		padding: var(--space-3) var(--space-5);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
</style>
