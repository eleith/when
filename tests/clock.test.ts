import { expect, test } from 'bun:test';
import { systemClock } from '../src/lib/server/clock';

test('systemClock returns a fresh Date', () => {
	const a = systemClock.now();
	expect(a).toBeInstanceOf(Date);
	expect(systemClock.nowMs()).toBeGreaterThan(0);
});
