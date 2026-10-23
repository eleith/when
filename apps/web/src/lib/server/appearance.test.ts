import { expect, test } from 'vitest';
import { themeStyleTag } from './appearance';
import { validConfig } from './__fixtures__/valid-config';

const base = validConfig.user.appearance;

const customColors = {
	primary_light_color: '#123456',
	primary_dark_color: '#abcdef',
	background_light_color: '#f1f2f3',
	background_dark_color: '#102030',
	text_light_color: '#234567',
	text_dark_color: '#fefefe'
};

test('configured light and dark colors share one scheme-aware palette', () => {
	const html = themeStyleTag({ ...base, ...customColors });

	expect(html).toContain('--when-color-primary: light-dark(#123456, #abcdef);');
	expect(html).toContain('--when-color-text: light-dark(#234567, #fefefe);');
	expect(html).toContain('--when-color-surface-page: light-dark(#f1f2f3, #102030);');
	expect(html).toContain('--when-color-text-on-primary: light-dark(#ffffff, #000000);');
	expect(html).not.toContain('@media');
	expect(html.match(/:root/g)).toHaveLength(1);
	expect(styleTagCounts(html)).toEqual({ opened: 1, closed: 1 });
});

test('each scheme keeps its configured text on primary when it has enough contrast', () => {
	const html = themeStyleTag({
		...base,
		...customColors,
		text_light_color: '#fefefe',
		text_dark_color: '#234567'
	});

	expect(html).toContain('--when-color-text-on-primary: light-dark(#fefefe, #234567);');
});

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
