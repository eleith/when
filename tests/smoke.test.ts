import { expect, test } from 'bun:test';

test('bun:test harness is wired up', () => {
	expect(1 + 1).toBe(2);
});
