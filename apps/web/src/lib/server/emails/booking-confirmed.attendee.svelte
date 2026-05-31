<script lang="ts">
	import { Layout, Heading, Actions, Button, DetailTable } from '$lib/server/email/components';
	import type { BookingLinks } from '$lib/server/booking/links';

	let {
		orgName,
		primaryColor,
		eventName,
		when,
		location,
		links
	}: {
		orgName: string;
		primaryColor?: string;
		eventName: string;
		when: string;
		location: string | null;
		links: BookingLinks;
	} = $props();
</script>

<Layout name={orgName} {primaryColor} footerHref={links.booked}>
	<Heading>Your booking is confirmed.</Heading>
	<DetailTable
		rows={[
			{ label: 'What', value: eventName },
			{ label: 'When', value: when },
			{ label: 'Where', value: location }
		]}
	/>
	<Actions>
		<Button href={links.reschedule} kind="secondary">Reschedule</Button>
		<Button href={links.cancel} kind="danger">Cancel</Button>
	</Actions>
</Layout>
