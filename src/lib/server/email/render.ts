import { render } from 'svelte/server';
import type { Component } from 'svelte';

// Email-standard doctype (XHTML 1.0 Transitional) — what Outlook/legacy clients expect.
const DOCTYPE =
	'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ' +
	'"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

// Svelte 5 SSR emits hydration anchors — `<!--[-->`, `<!--[0-->`, `<!--]-->`, `<!---->` —
// which are noise in an email. Matching only these (an optional `[`+digits or `]`) leaves
// legitimate Outlook conditional comments (`<!--[if mso]>…`) untouched.
function stripSvelteMarkers(html: string): string {
	return html.replace(/<!--(?:\[\d*|\])?-->/g, '');
}

/**
 * Render a Svelte email component to a complete, email-safe HTML string.
 * Interpolated `{values}` are auto-escaped by Svelte.
 */
export function renderEmail<P extends Record<string, unknown>>(
	component: Component<P>,
	props: P
): string {
	const { body } = render(component, { props });
	return DOCTYPE + '\n' + stripSvelteMarkers(body);
}
