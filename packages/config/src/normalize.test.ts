import { expect, test } from 'vitest';
import { withDerivedDefaults } from './normalize.js';

test('derives slug from meeting name when omitted', () => {
	const out = withDerivedDefaults({ meetings: [{ name: 'Team Sync Up!' }] }) as {
		meetings: { slug: string }[];
	};
	expect(out.meetings[0].slug).toBe('team-sync-up');
});

test('preserves an explicit slug', () => {
	const out = withDerivedDefaults({ meetings: [{ name: 'Team Sync', slug: 'sync' }] }) as {
		meetings: { slug: string }[];
	};
	expect(out.meetings[0].slug).toBe('sync');
});

test('fills schedule and booking_calendar from the sole entry', () => {
	const out = withDerivedDefaults({
		schedules: [{ name: 'standard' }],
		calendars: [{ name: 'work' }],
		meetings: [{ name: 'chat' }]
	}) as { meetings: Record<string, unknown>[] };
	expect(out.meetings[0]).toMatchObject({ schedule: 'standard', booking_calendar: 'work' });
});

test('defaults schedule and booking_calendar to the first when multiple exist', () => {
	const out = withDerivedDefaults({
		schedules: [{ name: 'a' }, { name: 'b' }],
		calendars: [{ name: 'x' }, { name: 'y' }],
		meetings: [{ name: 'chat' }]
	}) as { meetings: Record<string, unknown>[] };
	expect(out.meetings[0]).toMatchObject({ schedule: 'a', booking_calendar: 'x' });
});

test('defaults an omitted weekly to Monday-Friday business hours', () => {
	const out = withDerivedDefaults({ schedules: [{ name: 'standard' }] }) as {
		schedules: { weekly: unknown }[];
	};
	expect(out.schedules[0].weekly).toEqual([
		{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }
	]);
});

test('leaves an explicit weekly untouched', () => {
	const out = withDerivedDefaults({
		schedules: [{ name: 'mondays', weekly: [{ days: ['mon'], from: '09:00', to: '12:00' }] }]
	}) as { schedules: { weekly: unknown }[] };
	expect(out.schedules[0].weekly).toEqual([{ days: ['mon'], from: '09:00', to: '12:00' }]);
});

test('does not mutate its input', () => {
	const input = { schedules: [{ name: 'standard' }], meetings: [{ name: 'chat' }] };
	withDerivedDefaults(input);
	expect(input.meetings[0]).toEqual({ name: 'chat' });
});

test('tolerates malformed input without throwing', () => {
	expect(() => withDerivedDefaults(undefined)).not.toThrow();
	expect(() => withDerivedDefaults({ meetings: 'nope' })).not.toThrow();
	expect(() => withDerivedDefaults({ meetings: [null, 42] })).not.toThrow();
});
