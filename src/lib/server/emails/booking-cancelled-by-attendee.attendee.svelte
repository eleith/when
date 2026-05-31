<script lang="ts">
	import { Layout, Heading, DetailTable } from '$lib/server/email/components';

	let {
		orgName,
		primaryColor,
		eventName,
		when
	}: {
		orgName: string;
		primaryColor?: string;
		eventName: string;
		when: string;
	} = $props();
</script>

<Layout name={orgName} {primaryColor}>
	<Heading>Your booking has been cancelled.</Heading>
	<DetailTable
		rows={[
			{ label: 'What', value: eventName },
			{ label: 'When', value: when }
		]}
	/>
</Layout>
