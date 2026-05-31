<script lang="ts">
	import { Layout, Heading, DetailTable } from '$lib/server/email/components';

	let {
		orgName,
		primaryColor,
		eventName,
		when,
		userName
	}: {
		orgName: string;
		primaryColor?: string;
		eventName: string;
		when: string;
		userName: string;
	} = $props();
</script>

<Layout name={orgName} {primaryColor}>
	<Heading>{userName} cancelled this booking.</Heading>
	<DetailTable
		rows={[
			{ label: 'What', value: eventName },
			{ label: 'When', value: when }
		]}
	/>
</Layout>
