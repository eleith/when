import { expect, test } from 'vitest';
import { renderEmail } from './render';
import Probe from './render-probe.svelte';

test('renderEmail emits a doctype, escapes interpolation, and strips Svelte SSR markers', () => {
	const html = renderEmail(Probe, { name: '<b>x</b>', show: true });

	expect(html).toContain('<!DOCTYPE html');
	// Svelte auto-escapes interpolation — `<` becomes `&lt;`, so no tag injection.
	expect(html).toContain('Hello &lt;b>x&lt;/b>');
	expect(html).not.toContain('<b>x</b>');
	// {#if} block rendered…
	expect(html).toContain('<span>visible</span>');
	// …but its hydration markers are gone.
	expect(html).not.toContain('<!--');
});

test('renderEmail drops the {#if} branch when false', () => {
	const html = renderEmail(Probe, { name: 'Jane', show: false });
	expect(html).toContain('Hello Jane');
	expect(html).not.toContain('visible');
});
