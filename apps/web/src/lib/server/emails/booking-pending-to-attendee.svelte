<script lang="ts">
	import {
		Layout,
		Heading,
		Text,
		Actions,
		Button,
		DetailTable
	} from '$lib/server/email/components';
	import type { BookingLinks } from '$lib/server/booking/links';

	let {
		orgName,
		primaryColor,
		eventName,
		attendeeEmail,
		when,
		location,
		links
	}: {
		orgName: string;
		primaryColor?: string;
		eventName: string;
		attendeeEmail: string;
		when: string;
		location: string | null;
		links: BookingLinks;
	} = $props();
</script>

<Layout name={orgName} {primaryColor} footerHref={links.booked}>
	<Heading>Booking request received: {eventName}</Heading>
	<Text>
		{orgName} will review and confirm. You'll get a follow-up email at {attendeeEmail} with the outcome.
	</Text>
	<DetailTable
		rows={[
			{ label: 'When', value: when },
			{ label: 'Where', value: location }
		]}
	/>
	<Text>Need to change something before then?</Text>
	<Actions>
		<Button href={links.reschedule} kind="secondary">Reschedule</Button>
		<Button href={links.cancel} kind="danger">Cancel</Button>
	</Actions>
</Layout>
