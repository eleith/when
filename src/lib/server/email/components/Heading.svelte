<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<h2 style="margin:0 0 16px;font-size:18px;font-weight:700;color:#1a1a1a;">{@render children()}</h2>
