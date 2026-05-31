<script lang="ts">
	import type { Snippet } from 'svelte';
	import { DEFAULT_PRIMARY_COLOR } from './brand';

	let {
		name,
		primaryColor,
		footerHref,
		children
	}: {
		/** Organizer display name, shown in the footer. */
		name: string;
		/** Brand hex color for the header strip + primary buttons. */
		primaryColor?: string;
		/** Optional "View this booking" link in the footer. */
		footerHref?: string;
		children: Snippet;
	} = $props();

	const color = $derived(primaryColor || DEFAULT_PRIMARY_COLOR);
</script>

<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width,initial-scale=1" />
	</head>
	<body
		style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;"
	>
		<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
			<div style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
				<div style="height:6px;background:{color};"></div>
				<div style="padding:24px;font-size:15px;line-height:1.6;">
					{@render children()}
				</div>
			</div>
			<div style="text-align:center;color:#6b7280;font-size:12px;line-height:1.6;padding:16px 0;">
				{#if footerHref}<a href={footerHref} style="color:#6b7280;">View this booking</a><br
					/>{/if}{name}
				&middot; Powered by When
			</div>
		</div>
	</body>
</html>
