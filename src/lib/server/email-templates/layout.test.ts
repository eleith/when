import { expect, test } from 'vitest';
import { DEFAULT_PRIMARY_COLOR, wrap } from '$lib/server/email-templates/layout';
import { escapeHtml } from '$lib/server/email-templates/escape';

test('wrap returns a complete HTML document with doctype, head, and body', () => {
	const html = wrap({ brand: { name: 'Org' }, body: '<p>hello</p>' });
	expect(html.startsWith('<!doctype html>')).toBe(true);
	expect(html).toContain('<head>');
	expect(html).toContain('<body');
	expect(html).toContain('</html>');
});

test('wrap inlines the body content verbatim', () => {
	const html = wrap({
		brand: { name: 'Org' },
		body: '<p data-marker="x">body-marker</p>'
	});
	expect(html).toContain('<p data-marker="x">body-marker</p>');
});

test('wrap uses the supplied primary color in the header strip', () => {
	const html = wrap({
		brand: { name: 'Org', primaryColor: '#ff00aa' },
		body: ''
	});
	expect(html).toContain('background:#ff00aa');
});

test('wrap falls back to DEFAULT_PRIMARY_COLOR when none is provided', () => {
	const html = wrap({ brand: { name: 'Org' }, body: '' });
	expect(html).toContain(`background:${DEFAULT_PRIMARY_COLOR}`);
});

test('wrap HTML-escapes the brand name in the footer', () => {
	const nasty = `Evil <script>alert('x')</script>`;
	const html = wrap({ brand: { name: nasty }, body: '' });
	expect(html).toContain(escapeHtml(nasty));
	expect(html).not.toContain('<script>');
});

test('wrap renders the optional footer above the "Powered by When" line', () => {
	const html = wrap({
		brand: { name: 'Org' },
		body: '',
		footer: '<a href="https://example.com/booked/1">View booking</a>'
	});
	expect(html).toContain('<a href="https://example.com/booked/1">View booking</a>');
	expect(html).toContain('Powered by When');
	const footerIdx = html.indexOf('View booking');
	const poweredIdx = html.indexOf('Powered by When');
	expect(footerIdx).toBeLessThan(poweredIdx);
});

test('wrap omits the footer block but always renders "Powered by When"', () => {
	const html = wrap({ brand: { name: 'Org' }, body: '' });
	expect(html).toContain('Org');
	expect(html).toContain('Powered by When');
});

test('escapeHtml converts the five XML entities', () => {
	expect(escapeHtml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &#39;');
});
