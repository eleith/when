import { describe, expect, test } from 'vitest';
import { contrastText, tint } from './color.js';

describe('tint', () => {
	test('a full share is the color itself, a zero share is the ground', () => {
		expect(tint('#000000', '#ffffff', 1)).toBe('#000000');
		expect(tint('#000000', '#ffffff', 0)).toBe('#ffffff');
	});

	test('blends per channel', () => {
		expect(tint('#000000', '#ffffff', 0.5)).toBe('#808080');
		expect(tint('#ff0000', '#0000ff', 0.25)).toBe('#4000bf');
	});
});

describe('contrastText', () => {
	test('keeps the preferred color when it already clears AA', () => {
		expect(contrastText('#facc15', '#171717')).toBe('#171717');
	});

	test('falls back to white on a dark background', () => {
		expect(contrastText('#166534', '#171717')).toBe('#ffffff');
	});

	// The band a brightness threshold gets wrong: white lands under 3.5:1 on each.
	test.each(['#d97706', '#0ea5e9', '#10b981'])('picks dark text on %s', (background) => {
		expect(contrastText(background, '#171717')).toBe('#171717');
	});

	test('falls back to black when neither the preferred color nor white clears AA', () => {
		expect(contrastText('#9ca3af', '#a1a1aa')).toBe('#000000');
	});
});
