import { describe, expect, test } from 'vitest';
import { emailTheme } from './theme.js';
import type { Appearance } from '@when/config';

const appearance = {
	background_light_color: '#f5f5f5',
	text_light_color: '#171717'
} as Appearance;

describe('emailTheme', () => {
	test('takes the page ground and ink from the configured appearance', () => {
		const theme = emailTheme(appearance);
		expect(theme.pageBg).toBe('#f5f5f5');
		expect(theme.text).toBe('#171717');
	});

	test('derives the muted tones by blending the ink into the ground', () => {
		const theme = emailTheme(appearance);
		expect(theme.bodyText).toBe('#383838');
		expect(theme.label).toBe('#484848');
		expect(theme.border).toBe('#dfdfdf');
	});

	test('follows the configured ink hue rather than a fixed grey', () => {
		const warm = emailTheme({ ...appearance, text_light_color: '#3b1f0b' } as Appearance);
		expect(warm.label).toBe('#644e3e');
	});
});
