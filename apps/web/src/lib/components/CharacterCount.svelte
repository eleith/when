<script lang="ts">
	let { value, limit }: { value: string; limit: number } = $props();
</script>

<span class="count">{value.length}/{limit}</span>

<style>
	.count {
		display: block;
		margin-top: var(--space-1);
		text-align: right;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
