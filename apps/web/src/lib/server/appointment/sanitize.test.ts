import { describe, expect, test } from 'vitest';
import { toPublicEventType, toPublicAppointment } from './sanitize';
import { resolveBookingDurations } from './duration';
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
	video_chat_request: null,
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
	test('hides location for guests', () => {
		const profile = resolveBookingDurations(baseEventType, 'guest');
		const res = toPublicEventType('chat', baseEventType, 'guest', profile);
		expect(res.location).toBeUndefined();
	});

	test('shows location for hosts', () => {
		const profile = resolveBookingDurations(baseEventType, 'host');
		const res = toPublicEventType('chat', baseEventType, 'host', profile);
		expect(res.location).toBe('https://meet.example.com/jane');
	});

	test('applies default padding and notice values', () => {
		const profile = resolveBookingDurations(baseEventType, 'guest');
		const res = toPublicEventType('chat', baseEventType, 'guest', profile);
		expect(res.padding_before_minutes).toBe(0);
		expect(res.padding_after_minutes).toBe(0);
		expect(res.notice_minutes).toBe(120);
	});

	test('passes through explicit padding and notice values', () => {
		const meeting = {
			...baseEventType,
			padding_before_minutes: 15,
			padding_after_minutes: 10,
			notice_minutes: 60
		};
		const profile = resolveBookingDurations(meeting, 'guest');
		const res = toPublicEventType('chat', meeting, 'guest', profile);
		expect(res.padding_before_minutes).toBe(15);
		expect(res.padding_after_minutes).toBe(10);
		expect(res.notice_minutes).toBe(60);
	});

	test('projects effective host padding and role-specific choices without changing notice, privacy, or config', () => {
		const cfg = structuredClone(validConfig);
		const meeting = cfg.meetings['30-min-chat'];
		Object.assign(meeting, {
			location: baseEventType.location,
			padding_before_minutes: 15,
			padding_after_minutes: 10,
			daily_booking_limit: 1,
			notice_minutes: 60,
			additional_duration_minutes: [15, 60]
		});
		const original = structuredClone(cfg);
		const guestProfile = resolveBookingDurations(meeting, 'guest');
		const hostProfile = resolveBookingDurations(meeting, 'host');
		const guest = toPublicEventType('chat', meeting, 'guest', guestProfile);
		const host = toPublicEventType('chat', meeting, 'host', hostProfile);

		expect(guest.padding_before_minutes).toBe(15);
		expect(guest.padding_after_minutes).toBe(10);
		expect(guest.location).toBeUndefined();
		expect(guest.duration_minutes).toBe(30);
		expect(guest.durations).toEqual([30, 15, 60]);
		expect(guest.notice_minutes).toBe(60);
		expect(host).toEqual({
			...guest,
			durations: [15, 30, 45, 60, 90, 120, 180, 240, 300],
			location: meeting.location,
			padding_before_minutes: 0,
			padding_after_minutes: 0
		});
		expect(host.durations).toBe(hostProfile.durations);
		expect(guest.durations).toBe(guestProfile.durations);
		expect(toPublicEventType('chat', meeting, 'guest', guestProfile)).toEqual(guest);
		expect(cfg).toEqual(original);
	});

	test.each(['guest', 'host'] as const)(
		'%s consumes the supplied profile default and exact choice array instead of recomputing them',
		(role) => {
			const meeting = { ...baseEventType, duration_minutes: 60, additional_duration_minutes: [15] };
			const profile = { defaultDuration: 85, durations: [60, 15, 85] };
			const originalMeeting = structuredClone(meeting);
			const originalProfile = structuredClone(profile);
			const res = toPublicEventType('chat', meeting, role, profile);
			expect(res.duration_minutes).toBe(85);
			expect(res.durations).toBe(profile.durations);
			expect(res.durations).toEqual([60, 15, 85]);
			expect(meeting).toEqual(originalMeeting);
			expect(profile).toEqual(originalProfile);
		}
	);

	test('creation projects configured 60 as default even though the host choices start at 15', () => {
		const meeting = { ...baseEventType, duration_minutes: 60 };
		const profile = resolveBookingDurations(meeting, 'host');
		const res = toPublicEventType('chat', meeting, 'host', profile);
		expect(res.duration_minutes).toBe(60);
		expect(res.durations[0]).toBe(15);
	});

	test.each(['guest', 'host'] as const)(
		'%s reschedule projects actual current 90 instead of configured 30',
		(role) => {
			const current = { ...baseRow, end_time: '2026-05-01T16:30:00Z' };
			const profile = resolveBookingDurations(baseEventType, role, current);
			const res = toPublicEventType('chat', baseEventType, role, profile);
			expect(res.duration_minutes).toBe(90);
			expect(res.durations).toBe(profile.durations);
			expect(res.durations).toContain(30);
			expect(res.durations).toContain(90);
		}
	);

	test('maps show_slots', () => {
		const meeting = { ...baseEventType, show_slots: true };
		const profile = resolveBookingDurations(meeting, 'guest');
		const res = toPublicEventType('chat', meeting, 'guest', profile);
		expect(res.show_slots).toBe(true);
	});

	test('passes through require_approval', () => {
		const profile = resolveBookingDurations(baseEventType, 'guest');
		const res = toPublicEventType('chat', baseEventType, 'guest', profile);
		expect(res.require_approval).toBe(false);
	});
});

describe('toPublicAppointment decline note privacy', () => {
	const at = '2026-05-01T13:00:00Z';
	const declineNote = 'Sorry, not this time.\nPlease try Friday — merci.';
	const declineEntry = {
		action: 'decline',
		actor: 'host',
		at,
		payload: {
			note: declineNote,
			field: 'private-field',
			from: 'private-before',
			to: 'private-after',
			metadata: { internal_id: 'private-id', token: 'private-token' }
		}
	};

	test('exposes only the decline action, actor, time, and note to the declined guest', () => {
		const row: Appointment = {
			...baseRow,
			status: 'declined',
			action_log: JSON.stringify([
				{ action: 'confirm', actor: 'host', at },
				{ action: 'edit', actor: 'host', at, payload: { note: 'Private edit history' } },
				{ action: 'rotate', actor: 'host', at },
				declineEntry
			])
		};
		const original = structuredClone(row);

		const guest = toPublicAppointment(row, 'guest');

		expect(guest.note).toBeNull();
		expect(guest.location).toBeNull();
		expect(guest.video_chat).toBeNull();
		expect(guest.action_log).toStrictEqual([
			{
				action: 'decline',
				actor: 'host',
				at,
				payload: { note: declineNote, metadata: undefined }
			}
		]);
		expect(guest).not.toHaveProperty('cancel_token');
		expect(row).toEqual(original);

		const host = toPublicAppointment(row, 'host');
		expect(host.note).toBe(baseRow.note);
		expect(host.action_log).toEqual(JSON.parse(row.action_log!));
	});

	test.each(['pending', 'confirmed', 'cancelled', 'rescheduled', 'purged'] as const)(
		'never exposes inherited decline history on a %s row',
		(status) => {
			const row: Appointment = {
				...baseRow,
				status,
				action_log: JSON.stringify([declineEntry])
			};

			const guest = toPublicAppointment(row, 'guest');
			const host = toPublicAppointment(row, 'host');

			expect(guest.action_log).toEqual([]);
			expect(guest.note).toBe(status === 'confirmed' ? baseRow.note : null);
			expect(host.action_log).toEqual([declineEntry]);
			expect(host.note).toBe(baseRow.note);
		}
	);

	test('a decline without a note does not fall back to the general appointment note', () => {
		const row: Appointment = {
			...baseRow,
			status: 'declined',
			action_log: JSON.stringify([{ action: 'decline', actor: 'host', at }])
		};

		const guest = toPublicAppointment(row, 'guest');

		expect(guest.note).toBeNull();
		expect(guest.action_log).toStrictEqual([
			{ action: 'decline', actor: 'host', at, payload: { note: undefined, metadata: undefined } }
		]);
	});

	test('keeps decline and cancellation notes distinct and preserves only existing public move metadata', () => {
		const moveMetadata = { previous_id: 'old-row', next_id: 'new-row' };
		const row: Appointment = {
			...baseRow,
			status: 'declined',
			action_log: JSON.stringify([
				{
					action: 'cancel',
					actor: 'guest',
					at,
					payload: { note: 'Guest cancellation reason' }
				},
				{
					action: 'reschedule',
					actor: 'host',
					at,
					payload: { note: 'Move reason', metadata: moveMetadata }
				},
				declineEntry
			])
		};

		const guest = toPublicAppointment(row, 'guest');

		expect(guest.note).toBeNull();
		expect(guest.action_log).toStrictEqual([
			{
				action: 'cancel',
				actor: 'guest',
				at,
				payload: { note: 'Guest cancellation reason', metadata: undefined }
			},
			{
				action: 'reschedule',
				actor: 'host',
				at,
				payload: { note: 'Move reason', metadata: moveMetadata }
			},
			{ action: 'decline', actor: 'host', at, payload: { note: declineNote, metadata: undefined } }
		]);
	});
});

describe('toPublicAppointment', () => {
	test('shows location, note, and video_chat for hosts', () => {
		const res = toPublicAppointment(baseRow, 'host');
		expect(res.location).toBe('https://meet.example.com/jane');
		expect(res.note).toBe('Meeting prep document link: test');
		expect(res.video_chat).toBe('https://zoom.us/j/12345');
	});

	test('shows location, note, and video_chat for confirmed guests', () => {
		const res = toPublicAppointment(baseRow, 'guest');
		expect(res.location).toBe('https://meet.example.com/jane');
		expect(res.note).toBe('Meeting prep document link: test');
		expect(res.video_chat).toBe('https://zoom.us/j/12345');
	});

	test('hides location, note, and video_chat for pending guests', () => {
		const pendingRow = { ...baseRow, status: 'pending' as const };
		const res = toPublicAppointment(pendingRow, 'guest');
		expect(res.location).toBeNull();
		expect(res.note).toBeNull();
		expect(res.video_chat).toBeNull();
	});

	test('strips non-cancellation entries for guests', () => {
		const rowWithLog: Appointment = {
			...baseRow,
			action_log: JSON.stringify([{ action: 'confirm', actor: 'host', at: '2026-05-01T12:00:00Z' }])
		};
		const res = toPublicAppointment(rowWithLog, 'guest');
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

		const res = toPublicAppointment(rowWithLog, 'guest');

		expect(res.action_log.map((e) => e.action)).toEqual(['cancel']);
		expect(toPublicAppointment(rowWithLog, 'host').action_log.map((e) => e.action)).toEqual([
			'rotate',
			'cancel'
		]);
	});

	test('returns only sanitized cancellation entries in action_log for guests', () => {
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
		const res = toPublicAppointment(rowWithLog, 'guest');
		expect(res.action_log).toEqual([
			{
				action: 'cancel',
				actor: 'host',
				at: '2026-05-01T13:00:00Z',
				payload: { note: 'double booked', metadata: undefined }
			}
		]);
	});

	test('returns full action_log for hosts', () => {
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
		const res = toPublicAppointment(rowWithLog, 'host');
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
