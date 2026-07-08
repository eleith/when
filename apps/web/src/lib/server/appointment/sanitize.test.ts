import { describe, expect, test } from 'vitest';
import { toPublicEventType, toPublicAppointment } from './sanitize';
import type { Meeting } from '@when/config';
import type { Appointment } from '@when/db';

const baseEventType: Meeting = {
	name: '30-min-chat',
	duration_minutes: 30,
	slug: 'chat',
	booking_approval: 'instant',
	booking_calendar: 'main',
	location: 'https://meet.example.com/jane',
	schedule: 'standard'
};

const baseRow: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: '2026-05-01T15:00:00Z',
	end_time: '2026-05-01T15:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	guest_timezone: null,
	location: 'https://meet.example.com/jane',
	note: 'Meeting prep document link: test',
	video_chat: 'https://zoom.us/j/12345',
	status: 'confirmed',
	origin_id: 'appt-1',
	cancel_token: 'tok-abc',
	action_log: null,
	external_event_id: null,
	external_calendar_id: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	ics_sequence: 0,
	meeting_snapshot: null,
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
		expect(res.location).toBe('https://meet.example.com/jane');
	});

	test('maps settings when provided', () => {
		const settings = { buffer_before: 15, buffer_after: 10, minimum_notice: 60 };
		const res = toPublicEventType(baseEventType, false, settings);
		expect(res.buffer_before).toBe(15);
		expect(res.buffer_after).toBe(10);
		expect(res.minimum_notice).toBe(60);
	});

	test('maps booking_style', () => {
		const res = toPublicEventType({ ...baseEventType, booking_style: 'select' }, false);
		expect(res.booking_style).toBe('select');
	});
});

describe('toPublicAppointment', () => {
	test('shows location, note, and video_chat for admins', () => {
		const res = toPublicAppointment(baseRow, true);
		expect(res.location).toBe('https://meet.example.com/jane');
		expect(res.note).toBe('Meeting prep document link: test');
		expect(res.video_chat).toBe('https://zoom.us/j/12345');
	});

	test('shows location, note, and video_chat for confirmed non-admins', () => {
		const res = toPublicAppointment(baseRow, false);
		expect(res.location).toBe('https://meet.example.com/jane');
		expect(res.note).toBe('Meeting prep document link: test');
		expect(res.video_chat).toBe('https://zoom.us/j/12345');
	});

	test('hides location, note, and video_chat for pending non-admins', () => {
		const pendingRow = { ...baseRow, status: 'pending' as const };
		const res = toPublicAppointment(pendingRow, false);
		expect(res.location).toBeNull();
		expect(res.note).toBeNull();
		expect(res.video_chat).toBeNull();
	});

	test('strips non-cancellation entries for non-admins', () => {
		const rowWithLog: Appointment = {
			...baseRow,
			action_log: JSON.stringify([{ action: 'confirm', actor: 'host', at: '2026-05-01T12:00:00Z' }])
		};
		const res = toPublicAppointment(rowWithLog, false);
		expect(res.action_log).toEqual([]);
	});

	test('returns only sanitized cancellation entries in action_log for non-admins', () => {
		const rowWithLog: Appointment = {
			...baseRow,
			action_log: JSON.stringify([
				{ action: 'confirm', actor: 'host', at: '2026-05-01T12:00:00Z' },
				{
					action: 'cancel',
					actor: 'host',
					at: '2026-05-01T13:00:00Z',
					payload: { note: 'double booked' }
				}
			])
		};
		const res = toPublicAppointment(rowWithLog, false);
		expect(res.action_log).toEqual([
			{
				action: 'cancel',
				actor: 'host',
				at: '2026-05-01T13:00:00Z',
				payload: { note: 'double booked', metadata: undefined }
			}
		]);
	});

	test('returns full action_log for admins', () => {
		const rowWithLog: Appointment = {
			...baseRow,
			action_log: JSON.stringify([
				{ action: 'confirm', actor: 'host', at: '2026-05-01T12:00:00Z' },
				{
					action: 'cancel',
					actor: 'host',
					at: '2026-05-01T13:00:00Z',
					payload: { note: 'double booked' }
				}
			])
		};
		const res = toPublicAppointment(rowWithLog, true);
		expect(res.action_log).toEqual([
			{ action: 'confirm', actor: 'host', at: '2026-05-01T12:00:00Z' },
			{
				action: 'cancel',
				actor: 'host',
				at: '2026-05-01T13:00:00Z',
				payload: { note: 'double booked' }
			}
		]);
	});
});
