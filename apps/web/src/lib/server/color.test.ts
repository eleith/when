import { expect, test } from 'vitest';
import { getContrastText, hexToRgba } from './color';

test('hexToRgba expands 6- and 3-digit hex', () => {
	expect(hexToRgba('#171717', 0.58)).toBe('rgba(23, 23, 23, 0.58)');
	expect(hexToRgba('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
});

test('hexToRgba falls back to white for invalid input', () => {
	expect(hexToRgba('not-a-color', 0.2)).toBe('rgba(255, 255, 255, 0.2)');
});

test('getContrastText keeps the text color when it has enough contrast', () => {
	expect(getContrastText('#f5f5f5', '#171717')).toBe('#171717');
});

test('getContrastText falls back to white when the text color is too dark', () => {
	expect(getContrastText('#166534', '#0a0a0a')).toBe('#ffffff');
});

test('getContrastText falls back to black when nothing else contrasts', () => {
	expect(getContrastText('#808080', '#909090')).toBe('#000000');
});
