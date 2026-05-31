<script lang="ts">
	import { Layout, Heading, Text, Actions, Button, DetailTable } from './index';
	let { name, primaryColor }: { name: string; primaryColor?: string } = $props();
</script>

<Layout {name} {primaryColor} footerHref="https://example.com/booked/1">
	<Heading>Sample heading</Heading>
	<Text>A paragraph.</Text>
	<DetailTable
		rows={[
			{ label: 'When', value: 'Tomorrow' },
			{ label: 'Where', value: null }
		]}
	/>
	<Actions>
		<Button href="https://example.com/r" kind="secondary">Reschedule</Button>
		<Button href="https://example.com/c" kind="danger">Cancel</Button>
		<Button href="https://example.com/a" kind="primary" {primaryColor}>Accept</Button>
	</Actions>
</Layout>
