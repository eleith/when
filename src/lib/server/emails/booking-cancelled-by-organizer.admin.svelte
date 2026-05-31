<script lang="ts">
	import { Layout, Heading, Text, DetailTable } from '$lib/server/email/components';

	let {
		orgName,
		primaryColor,
		eventName,
		attendeeLine,
		when
	}: {
		orgName: string;
		primaryColor?: string;
		eventName: string;
		attendeeLine: string;
		when: string;
	} = $props();
</script>

<Layout name={orgName} {primaryColor}>
	<Heading>Cancelled: {eventName}</Heading>
	<Text>You cancelled {attendeeLine} booking for {eventName}.</Text>
	<DetailTable rows={[{ label: 'When', value: when }]} />
</Layout>
