import { expect, test } from 'vitest';
import { renderEmail } from '../render';
import Sample from './sample.svelte';

test('primitives compose into a complete email document', () => {
	const html = renderEmail(Sample, { name: 'Jane Doe', primaryColor: '#ff0000' });

	expect(html).toContain('<!DOCTYPE html');
	expect(html).toContain('<html');
	expect(html).toContain('Sample heading');
	expect(html).toContain('Powered by When');
	expect(html).toContain('Jane Doe');
	expect(html).toContain('View this booking');

	// header strip + primary button both pick up the brand color
	expect(html).toContain('background:#ff0000;');
	expect(html).toContain('background:#ff0000;color:#ffffff'); // the primary button

	// DetailTable shows truthy rows, drops the null one
	expect(html).toContain('Tomorrow');
	expect(html).not.toContain('Where');

	// no leftover Svelte SSR markers
	expect(html).not.toContain('<!--');
});
