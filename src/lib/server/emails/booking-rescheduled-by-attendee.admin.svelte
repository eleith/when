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
	<Heading>Rescheduled: {eventName}</Heading>
	<Text>{attendeeLine} rescheduled {eventName}.</Text>
	<DetailTable rows={[{ label: 'When', value: when }]} />
</Layout>
