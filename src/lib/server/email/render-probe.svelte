<script lang="ts">
	let { name, show }: { name: string; show: boolean } = $props();
</script>

<p>Hello {name}</p>
{#if show}<span>visible</span>{/if}
