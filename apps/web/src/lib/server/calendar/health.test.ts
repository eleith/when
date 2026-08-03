import { expect, test } from 'vitest';
import type { ServiceStatus } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { evaluateCalendarStatuses } from './health.js';

const START = Temporal.Instant.from('2026-05-01T00:00:00Z');

const config = {
	providers: [
		{
			name: 'dav',
			type: 'caldav',
			calendars: [{ name: 'work', sync: { refresh_every_minutes: 10 } }]
		}
	],
	meetings: [{ name: 'chat', booking_calendar: 'work' }]
} as unknown as WhenConfiguration;

test('evaluateCalendarStatuses: good status when recently refreshed', () => {
	const syncStatus: ServiceStatus[] = [
		{
			kind: 'calendar',
			name: 'work',
			last_attempt_at: START.toString(),
			last_ok_at: START.toString(),
			failing_since: null,
			error: null,
			via: 'refresh'
		}
	];
	const results = evaluateCalendarStatuses(syncStatus, config, START.add({ minutes: 5 }));

	expect(results).toEqual([
		{
			id: 'work',
			health: 'good',
			reason: null,
			since: null
		}
	]);
});

test('evaluateCalendarStatuses: bad status when stale (exceeds interval + grace)', () => {
	const syncStatus: ServiceStatus[] = [
		{
			kind: 'calendar',
			name: 'work',
			last_attempt_at: START.toString(),
			last_ok_at: START.toString(),
			failing_since: null,
			error: null,
			via: 'refresh'
		}
	];
	const results = evaluateCalendarStatuses(syncStatus, config, START.add({ hours: 2 }));

	expect(results).toEqual([
		{
			id: 'work',
			health: 'bad',
			reason: `No successful refresh since ${START.toString()}.`,
			since: START.toString()
		}
	]);
});

test('evaluateCalendarStatuses: bad status when never synced and past grace', () => {
	const syncStatus: ServiceStatus[] = [
		{
			kind: 'calendar',
			name: 'work',
			last_attempt_at: START.toString(),
			last_ok_at: null,
			failing_since: START.toString(),
			error: 'connection timeout',
			via: 'refresh'
		}
	];
	const results = evaluateCalendarStatuses(syncStatus, config, START.add({ minutes: 20 }));

	expect(results).toEqual([
		{
			id: 'work',
			health: 'bad',
			reason: 'Never synced: connection timeout',
			since: START.toString()
		}
	]);
});

test('a recorded error is bad even when the last success was recent', () => {
	const syncStatus: ServiceStatus[] = [
		{
			kind: 'calendar',
			name: 'work',
			last_attempt_at: START.add({ minutes: 5 }).toString(),
			last_ok_at: START.toString(),
			failing_since: START.add({ minutes: 5 }).toString(),
			error: 'PUT failed: 507',
			via: 'push'
		}
	];

	expect(evaluateCalendarStatuses(syncStatus, config, START.add({ minutes: 10 }))).toEqual([
		{
			id: 'work',
			health: 'bad',
			reason: 'PUT failed: 507',
			since: START.add({ minutes: 5 }).toString()
		}
	]);
});
