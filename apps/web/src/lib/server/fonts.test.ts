import { expect, test } from 'vitest';
import { FALLBACK_FONT_NAME, bundledFontUrls, fontStack, isBundledFont } from './fonts';

test('isBundledFont matches families case-insensitively', () => {
	expect(isBundledFont('Noto Sans')).toBe(true);
	expect(isBundledFont('outfit')).toBe(true);
	expect(isBundledFont('Comic Sans')).toBe(false);
});

test('bundledFontUrls derives per-weight urls from the family name', () => {
	expect(bundledFontUrls('Noto Sans')).toEqual([
		'/assets/fonts/noto-sans/noto-sans-latin-400-normal.woff2',
		'/assets/fonts/noto-sans/noto-sans-latin-600-normal.woff2',
		'/assets/fonts/noto-sans/noto-sans-latin-700-normal.woff2'
	]);
	expect(bundledFontUrls('Lato')).toEqual([
		'/assets/fonts/lato/lato-latin-400-normal.woff2',
		'/assets/fonts/lato/lato-latin-700-normal.woff2'
	]);
	expect(bundledFontUrls('Unknown')).toEqual([]);
});

test('fontStack backs only custom fonts with the fallback', () => {
	expect(fontStack('Lato')).toBe('Lato');
	expect(fontStack('My Font')).toBe(`My Font, ${FALLBACK_FONT_NAME}`);
});
