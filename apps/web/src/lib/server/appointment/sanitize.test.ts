import { describe, expect, test } from 'vitest';
import { toPublicEventType, toPublicAppointment } from './sanitize';
import type { EventType } from '@when/config';
import type { Appointment } from '@when/db';

const baseEventType: EventType = {
	id: '30-min-chat',
	name: '30-minute chat',
	duration: 30,
	slug: 'chat',
	appointment_flow: 'auto',
	destination_calendar: 'main',
	location: { mode: 'fixed', fixed: 'https://meet.example.com/jane' }
};

const baseRow: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: '2026-05-01T15:00:00Z',
	end_time: '2026-05-01T15:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_answers: null,
	attendee_timezone: null,
	location: 'https://meet.example.com/jane',
	status: 'confirmed',
	origin_id: 'appt-1',
	rescheduled_from_id: null,
	rescheduled_to_id: null,
	cancel_token: 'tok-abc',
	action_log: null,
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: 'ok',
	calendar_push_notification_status: 'ok',
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	calendar_push_failing_since: null,
	ics_sequence: 0,
	event_type_snapshot: null,
	created_at: '',
	updated_at: ''
};

describe('toPublicEventType', () => {
	test('hides location for non-admins', () => {
		const res = toPublicEventType(baseEventType, false);
		expect(res.location).toBeNull();
	});

	test('shows location for admins', () => {
		const res = toPublicEventType(baseEventType, true);
		expect(res.location).toEqual({ mode: 'fixed', fixed: 'https://meet.example.com/jane' });
	});

	test('maps settings when provided', () => {
		const settings = { buffer_before: 15, buffer_after: 10, minimum_notice: 60 };
		const res = toPublicEventType(baseEventType, false, settings);
		expect(res.buffer_before).toBe(15);
		expect(res.buffer_after).toBe(10);
		expect(res.minimum_notice).toBe(60);
	});
});

describe('toPublicAppointment', () => {
	test('shows all fields for admins', () => {
		const res = toPublicAppointment(baseRow, true);
		expect(res.location).toBe('https://meet.example.com/jane');
		expect(res.email_notification_status).toBe('ok');
		expect(res.calendar_push_notification_status).toBe('ok');
	});

	test('shows location and hides notification status for confirmed non-admins', () => {
		const res = toPublicAppointment(baseRow, false);
		expect(res.location).toBe('https://meet.example.com/jane');
		expect(res.email_notification_status).toBeNull();
		expect(res.calendar_push_notification_status).toBeNull();
	});

	test('hides location and notification status for pending non-admins', () => {
		const pendingRow = { ...baseRow, status: 'pending' as const };
		const res = toPublicAppointment(pendingRow, false);
		expect(res.location).toBeNull();
		expect(res.email_notification_status).toBeNull();
		expect(res.calendar_push_notification_status).toBeNull();
	});

	test('strips non-cancellation entries for non-admins', () => {
		const rowWithLog: Appointment = {
			...baseRow,
			action_log: JSON.stringify([{ action: 'confirm', actor: 'organizer', at: '2026-05-01T12:00:00Z' }])
		};
		const res = toPublicAppointment(rowWithLog, false);
		expect(res.action_log).toEqual([]);
	});

	test('returns only sanitized cancellation entries in action_log for non-admins', () => {
		const rowWithLog: Appointment = {
			...baseRow,
			action_log: JSON.stringify([
				{ action: 'confirm', actor: 'organizer', at: '2026-05-01T12:00:00Z' },
				{ action: 'cancel', actor: 'organizer', at: '2026-05-01T13:00:00Z', payload: { note: 'double booked' } }
			])
		};
		const res = toPublicAppointment(rowWithLog, false);
		expect(res.action_log).toEqual([
			{ action: 'cancel', at: '2026-05-01T13:00:00Z', payload: { note: 'double booked' } }
		]);
	});

	test('returns full action_log for admins', () => {
		const rowWithLog: Appointment = {
			...baseRow,
			action_log: JSON.stringify([
				{ action: 'confirm', actor: 'organizer', at: '2026-05-01T12:00:00Z' },
				{ action: 'cancel', actor: 'organizer', at: '2026-05-01T13:00:00Z', payload: { note: 'double booked' } }
			])
		};
		const res = toPublicAppointment(rowWithLog, true);
		expect(res.action_log).toEqual([
			{ action: 'confirm', actor: 'organizer', at: '2026-05-01T12:00:00Z' },
			{ action: 'cancel', actor: 'organizer', at: '2026-05-01T13:00:00Z', payload: { note: 'double booked' } }
		]);
	});
});
