<script lang="ts">
	import type { Snippet } from 'svelte';
	import { DEFAULT_PRIMARY_COLOR } from './brand';

	let {
		href,
		kind = 'secondary',
		primaryColor,
		children
	}: {
		href: string;
		kind?: 'primary' | 'secondary' | 'danger';
		/** Brand color for `kind="primary"`; ignored otherwise. */
		primaryColor?: string;
		children: Snippet;
	} = $props();

	const base = 'display:inline-block;text-decoration:none;border-radius:6px;margin:0 8px 8px 0;';
	const style = $derived(
		kind === 'primary'
			? `${base}padding:10px 20px;background:${primaryColor || DEFAULT_PRIMARY_COLOR};color:#ffffff;font-weight:600;`
			: kind === 'danger'
				? `${base}padding:10px 18px;border:1px solid #fecaca;color:#b91c1c;`
				: `${base}padding:10px 18px;border:1px solid #d1d5db;color:#1a1a1a;`
	);
</script>

<a {href} {style}>{@render children()}</a>
