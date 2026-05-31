<script lang="ts">
	import {
		Layout,
		Heading,
		Text,
		Actions,
		Button,
		DetailTable
	} from '$lib/server/email/components';

	let {
		orgName,
		primaryColor,
		eventName,
		attendeeLine,
		when,
		duration,
		location,
		manageUrl
	}: {
		orgName: string;
		primaryColor?: string;
		eventName: string;
		attendeeLine: string;
		when: string;
		duration: string | null;
		location: string | null;
		manageUrl: string;
	} = $props();
</script>

<Layout name={orgName} {primaryColor}>
	<Heading>Booking request: {eventName}</Heading>
	<Text>{attendeeLine} has requested to book {eventName}.</Text>
	<DetailTable
		rows={[
			{ label: 'When', value: when },
			{ label: 'Duration', value: duration },
			{ label: 'Where', value: location }
		]}
	/>
	<Actions>
		<Button href={manageUrl} kind="primary" {primaryColor}>Review request</Button>
	</Actions>
</Layout>
