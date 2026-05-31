<script lang="ts">
	export type DetailRow = { label: string; value: string | null | undefined };
	let { rows }: { rows: DetailRow[] } = $props();
	const shown = $derived(rows.filter((r): r is { label: string; value: string } => !!r.value));
</script>

{#if shown.length}
	<table style="border-collapse:collapse;margin:8px 0 24px;font-size:14px;">
		<tbody>
			{#each shown as row (row.label)}
				<tr>
					<td
						style="padding:4px 16px 4px 0;color:#6b7280;font-weight:600;white-space:nowrap;vertical-align:top;"
						>{row.label}</td
					>
					<td style="padding:4px 0;vertical-align:top;">{row.value}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}
