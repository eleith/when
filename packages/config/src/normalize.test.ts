import { expect, test } from 'vitest';
import { withDerivedDefaults } from './normalize.js';

test('defaults an omitted weekly to Monday-Friday business hours', () => {
	const out = withDerivedDefaults({ schedules: { standard: {} } }) as {
		schedules: Record<string, { weekly: unknown }>;
	};
	expect(out.schedules.standard.weekly).toEqual([
		{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }
	]);
});

test('leaves an explicit weekly untouched', () => {
	const out = withDerivedDefaults({
		schedules: { mondays: { weekly: [{ days: ['mon'], from: '09:00', to: '12:00' }] } }
	}) as { schedules: Record<string, { weekly: unknown }> };
	expect(out.schedules.mondays.weekly).toEqual([{ days: ['mon'], from: '09:00', to: '12:00' }]);
});

test('does not mutate its input', () => {
	const input = { schedules: { standard: {} } };
	withDerivedDefaults(input);
	expect(input.schedules.standard).toEqual({});
});

test('tolerates malformed input without throwing', () => {
	expect(() => withDerivedDefaults(undefined)).not.toThrow();
	expect(() => withDerivedDefaults({ schedules: 'nope' })).not.toThrow();
	expect(() => withDerivedDefaults({ schedules: { a: null, b: 42 } })).not.toThrow();
});
