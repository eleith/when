import { expect, test } from 'vitest';
import { icsParameter, icsValue } from './text.js';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const BEL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(127);

test('icsValue normalizes a bare CR, which ts-ics would otherwise emit verbatim', () => {
	expect(icsValue(`A${CR}B`)).toBe(`A${LF}B`);
	expect(icsValue(`A${CR}${LF}B`)).toBe(`A${LF}B`);
});

test('icsValue keeps newlines and tabs — ts-ics escapes both correctly', () => {
	expect(icsValue(`A${TAB}B${LF}C`)).toBe(`A${TAB}B${LF}C`);
});

test('icsValue removes other control characters', () => {
	expect(icsValue(`A${BEL}B${NUL}C${DEL}D`)).toBe('ABCD');
});

test('icsParameter allows no line break at all', () => {
	expect(icsParameter(`A${CR}B`)).toBe('A B');
	expect(icsParameter(`A${CR}${LF}B${TAB}C`)).toBe('A B C');
});

test('icsParameter removes the characters RFC 5545 would require quoting', () => {
	expect(icsParameter('Doe, Jane;PARTSTAT=X:mailto:evil@example.com')).toBe(
		'Doe  Jane PARTSTAT=X mailto evil@example.com'
	);
	expect(icsParameter('say "hi"')).toBe('say hi');
});

test('ordinary text is untouched', () => {
	expect(icsValue('Jane Doe — café ☕')).toBe('Jane Doe — café ☕');
	expect(icsParameter('Jane Doe — café ☕')).toBe('Jane Doe — café ☕');
});
