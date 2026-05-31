<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<p style="margin:24px 0 0;line-height:1.8;">{@render children()}</p>
