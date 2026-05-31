<script lang="ts">
	import { Layout, Heading, Text, DetailTable } from '$lib/server/email/components';

	let {
		orgName,
		primaryColor,
		eventName,
		attendeeLine,
		when,
		location,
		notes
	}: {
		orgName: string;
		primaryColor?: string;
		eventName: string;
		attendeeLine: string;
		when: string;
		location: string | null;
		notes: string | null;
	} = $props();
</script>

<Layout name={orgName} {primaryColor}>
	<Heading>New booking: {eventName}</Heading>
	<Text>{attendeeLine} just booked {eventName}.</Text>
	<DetailTable
		rows={[
			{ label: 'When', value: when },
			{ label: 'Where', value: location },
			{ label: 'Notes', value: notes }
		]}
	/>
</Layout>
