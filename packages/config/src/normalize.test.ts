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

test('defaults an omitted video_chat.attach to { auto: true }', () => {
	const out = withDerivedDefaults({
		meetings: { chat: { video_chat: { provider: 'google-service' } } }
	}) as { meetings: Record<string, { video_chat: { provider: string; attach: unknown } }> };
	expect(out.meetings.chat.video_chat.attach).toEqual({ auto: true });
});

test('leaves an explicit video_chat.attach untouched', () => {
	const out = withDerivedDefaults({
		meetings: { chat: { video_chat: { provider: 'google-service', attach: { auto: false } } } }
	}) as { meetings: Record<string, { video_chat: { provider: string; attach: unknown } }> };
	expect(out.meetings.chat.video_chat.attach).toEqual({ auto: false });
});

test('tolerates malformed input without throwing', () => {
	expect(() => withDerivedDefaults(undefined)).not.toThrow();
	expect(() => withDerivedDefaults({ schedules: 'nope' })).not.toThrow();
	expect(() => withDerivedDefaults({ schedules: { a: null, b: 42 } })).not.toThrow();
	expect(() => withDerivedDefaults({ meetings: 'nope' })).not.toThrow();
	expect(() => withDerivedDefaults({ meetings: { a: null, b: 42 } })).not.toThrow();
});
