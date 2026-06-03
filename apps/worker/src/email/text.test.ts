import { expect, test } from 'vitest';
import { lines } from './text.js';

test('lines joins, drops null/undefined/false, keeps empty strings as blanks', () => {
	expect(lines('a', false, 'b', null, '', undefined, 'c')).toBe('a\nb\n\nc');
});
