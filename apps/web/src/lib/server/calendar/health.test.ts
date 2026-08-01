import { expect, test } from 'vitest';
import type { ServiceStatus, Appointment } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import { evaluateCalendarStatuses } from './health.js';

const START = Temporal.Instant.from('2026-05-01T00:00:00Z');

const config = {
	calendars: [{ name: 'work' }],
	meetings: [{ name: 'chat', booking_calendar: 'work' }]
} as unknown as WhenConfiguration;

const calendarFailedLog = (at: string) =>
	JSON.stringify([
		{
			action: 'calendar',
			actor: 'system',
			at,
			payload: { metadata: { state: 'failed', appointment_id: '1' } }
		}
	]);

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
	const outOfSync: Appointment[] = [];
	const results = evaluateCalendarStatuses(
		syncStatus,
		outOfSync,
		config,
		START.add({ minutes: 5 })
	);

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
	const outOfSync: Appointment[] = [];
	const results = evaluateCalendarStatuses(syncStatus, outOfSync, config, START.add({ hours: 2 }));

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
			failing_since: null,
			error: 'connection timeout',
			via: 'refresh'
		}
	];
	const outOfSync: Appointment[] = [];
	const results = evaluateCalendarStatuses(
		syncStatus,
		outOfSync,
		config,
		START.add({ minutes: 20 })
	);

	expect(results).toEqual([
		{
			id: 'work',
			health: 'bad',
			reason: 'Never synced: connection timeout',
			since: START.toString()
		}
	]);
});

test('evaluateCalendarStatuses: bad status when write failure is open past threshold', () => {
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
	const outOfSync: Appointment[] = [
		{
			id: '1',
			event_type_id: 'chat',
			start_time: '2026-06-01T10:00:00Z',
			end_time: '2026-06-01T10:30:00Z',
			guest_name: 'A',
			guest_email: 'a@example.com',
			guest_answers: null,
			guest_timezone: null,
			location: null,
			note: null,
			video_chat: null,
			status: 'confirmed',
			origin_id: null,
			cancel_token: 't',
			action_log: calendarFailedLog(START.toString()),
			external_event_id: 'ext_event_1',
			external_calendar_id: 'work',
			calendar_revision: 2,
			calendar_synced_revision: 1,
			has_possible_conflict: 0,
			ics_sequence: 1,
			meeting_snapshot: null,
			created_at: START.toString(),
			updated_at: START.toString()
		}
	];
	const results = evaluateCalendarStatuses(
		syncStatus,
		outOfSync,
		config,
		START.add({ minutes: 40 })
	);

	expect(results).toEqual([
		{
			id: 'work',
			health: 'bad',
			reason: 'An appointment has failed to sync to this calendar for over 30 minutes.',
			since: START.toString()
		}
	]);
});
