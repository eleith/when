import { expect, test } from 'vitest';
import { themeStyleTag } from './appearance';
import { validConfig } from './__fixtures__/valid-config';

const base = validConfig.user.appearance;

// A stray `</style` would end the element early and put the rest in the document.
function styleTagCounts(html: string) {
	return {
		opened: (html.match(/<style>/g) ?? []).length,
		closed: (html.match(/<\/style/gi) ?? []).length
	};
}

test.for([
	'</style><script>alert(1)</script>',
	"</STYLE><img src=x onerror='alert(1)'>",
	"'; } :root { display: none } /*"
])('a font name of %s stays inside the style element', (font_name) => {
	const html = themeStyleTag({ ...base, font_name, font_path: '/custom.woff2' });

	const counts = styleTagCounts(html);
	expect(counts.closed).toBe(counts.opened);
	expect(html).not.toContain('<script');
	expect(html).not.toContain('<img');
});

test('a font url cannot break out of the url() it sits in', () => {
	const html = themeStyleTag({
		...base,
		font_path: "/f.woff2') } </style><script>alert(1)</script><style>a{"
	});

	const counts = styleTagCounts(html);
	expect(counts.closed).toBe(counts.opened);
	expect(html).not.toContain('<script');
});

test('an apostrophe in a real font name is escaped, not dropped', () => {
	const html = themeStyleTag({ ...base, font_name: "Amy's Font", font_path: '/amy.woff2' });

	expect(html).toContain("'Amy\\'s Font'");
	expect(styleTagCounts(html)).toEqual({ opened: 1, closed: 1 });
});

test('a bundled font needs no fallback in the stack', () => {
	const html = themeStyleTag({ ...base, font_name: 'Noto Sans' });

	expect(html).toContain("--when-font-family: 'Noto Sans';");
});

test('a custom font falls back to the bundled family', () => {
	const html = themeStyleTag({ ...base, font_name: 'Amy Sans' });

	expect(html).toContain("--when-font-family: 'Amy Sans', 'Noto Sans';");
});
