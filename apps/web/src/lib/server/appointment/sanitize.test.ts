import { describe, expect, test } from 'vitest';
import { toPublicEventType, toPublicAppointment } from './sanitize';
import type { Meeting } from '@when/config';
import type { Appointment } from '@when/db';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

const baseEventType: Meeting = {
	...validConfig.meetings['30-min-chat'],
	booking_calendar: 'main',
	location: 'https://meet.example.com/jane'
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
		const res = toPublicEventType('chat', baseEventType, false);
		expect(res.location).toBeUndefined();
	});

	test('shows location for admins', () => {
		const res = toPublicEventType('chat', baseEventType, true);
		expect(res.location).toBe('https://meet.example.com/jane');
	});

	test('applies default padding and notice values', () => {
		const res = toPublicEventType('chat', baseEventType, false);
		expect(res.padding_before_minutes).toBe(0);
		expect(res.padding_after_minutes).toBe(0);
		expect(res.notice_minutes).toBe(120);
	});

	test('passes through explicit padding and notice values', () => {
		const res = toPublicEventType(
			'chat',
			{
				...baseEventType,
				padding_before_minutes: 15,
				padding_after_minutes: 10,
				notice_minutes: 60
			},
			false
		);
		expect(res.padding_before_minutes).toBe(15);
		expect(res.padding_after_minutes).toBe(10);
		expect(res.notice_minutes).toBe(60);
	});

	test('maps show_slots', () => {
		const res = toPublicEventType('chat', { ...baseEventType, show_slots: true }, false);
		expect(res.show_slots).toBe(true);
	});

	test('passes through require_approval', () => {
		const res = toPublicEventType('chat', baseEventType, false);
		expect(res.require_approval).toBe(false);
	});

	test('sets has_video_chat for admins based on meeting video_chat config', () => {
		const eventWithVideo = {
			...baseEventType,
			video_chat: { provider: 'google-service' }
		};
		const adminRes = toPublicEventType('chat', eventWithVideo, true);
		expect(adminRes.has_video_chat).toBe(true);

		const guestRes = toPublicEventType('chat', eventWithVideo, false);
		expect(guestRes.has_video_chat).toBeUndefined();

		const noVideoRes = toPublicEventType('chat', baseEventType, true);
		expect(noVideoRes.has_video_chat).toBe(false);
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

	test('never shows a guest that their link was rotated', () => {
		const rowWithLog: Appointment = {
			...baseRow,
			action_log: JSON.stringify([
				{ action: 'rotate', actor: 'host', at: '2026-05-01T12:00:00Z' },
				{ action: 'cancel', actor: 'host', at: '2026-05-01T13:00:00Z' }
			])
		};

		const res = toPublicAppointment(rowWithLog, false);

		expect(res.action_log.map((e) => e.action)).toEqual(['cancel']);
		expect(toPublicAppointment(rowWithLog, true).action_log.map((e) => e.action)).toEqual([
			'rotate',
			'cancel'
		]);
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
