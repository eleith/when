import { expect, test } from 'vitest';
import { systemClock } from '$lib/server/clock';

test('systemClock returns a fresh Date', () => {
	const a = systemClock.now();
	expect(a).toBeInstanceOf(Date);
	expect(systemClock.nowMs()).toBeGreaterThan(0);
});
