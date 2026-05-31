<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<p style="margin:0 0 16px;">{@render children()}</p>
