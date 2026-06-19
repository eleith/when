import { describe, expect, test } from 'vitest';
import {
	BOOKING_VIEW_GRACE_DAYS,
	isCancelAllowed,
	isRescheduleAllowed,
	isViewable,
	requireViewableAppointment
} from './access';
import type { Appointment } from '@when/db';

const baseRow: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: '2026-05-01T15:00:00Z',
	end_time: '2026-05-01T15:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_answers: null,
	attendee_timezone: null,
	location: null,
	status: 'confirmed',
	origin_id: 'appt-1',
	rescheduled_from_id: null,
	rescheduled_to_id: null,
	cancel_token: 'tok-abc',
	external_event_id: null,
	external_calendar_id: null,
	email_notification_status: null,
	calendar_push_notification_status: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	calendar_push_failing_since: null,
	ics_sequence: 0,
	event_type_snapshot: null,
	created_at: '',
	updated_at: ''
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe('isViewable', () => {
	test('true before end_time', () => {
		expect(isViewable(baseRow, new Date('2026-05-01T14:00:00Z'))).toBe(true);
	});

	test('true within grace window', () => {
		const now = new Date(Date.parse(baseRow.end_time) + (BOOKING_VIEW_GRACE_DAYS - 1) * DAY_MS);
		expect(isViewable(baseRow, now)).toBe(true);
	});

	test('false at exact grace boundary', () => {
		const now = new Date(Date.parse(baseRow.end_time) + BOOKING_VIEW_GRACE_DAYS * DAY_MS);
		expect(isViewable(baseRow, now)).toBe(false);
	});

	test('false past grace window', () => {
		const now = new Date(Date.parse(baseRow.end_time) + (BOOKING_VIEW_GRACE_DAYS + 1) * DAY_MS);
		expect(isViewable(baseRow, now)).toBe(false);
	});

	test('viewable independent of status (signature accepts only end_time)', () => {
		expect(isViewable({ end_time: baseRow.end_time }, new Date('2026-05-01T14:00:00Z'))).toBe(true);
	});
});

describe('isCancelAllowed', () => {
	test('true for confirmed before start', () => {
		expect(isCancelAllowed(baseRow, new Date('2026-05-01T14:00:00Z'))).toBe(true);
	});

	test('true for pending before start', () => {
		expect(
			isCancelAllowed({ ...baseRow, status: 'pending' }, new Date('2026-05-01T14:00:00Z'))
		).toBe(true);
	});

	test('false at exact start_time', () => {
		expect(isCancelAllowed(baseRow, new Date(baseRow.start_time))).toBe(false);
	});

	test('false after start_time', () => {
		expect(isCancelAllowed(baseRow, new Date('2026-05-01T15:30:00Z'))).toBe(false);
	});

	test('false for cancelled', () => {
		expect(
			isCancelAllowed({ ...baseRow, status: 'cancelled' }, new Date('2026-05-01T14:00:00Z'))
		).toBe(false);
	});

	test('false for declined', () => {
		expect(
			isCancelAllowed({ ...baseRow, status: 'declined' }, new Date('2026-05-01T14:00:00Z'))
		).toBe(false);
	});
});

describe('isRescheduleAllowed', () => {
	test('true when notice window is satisfied', () => {
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T13:00:00Z'), 60)).toBe(true);
	});

	test('true at exact notice boundary', () => {
		// minimum_notice = 60min; now + 60min === start_time → allowed
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T14:00:00Z'), 60)).toBe(true);
	});

	test('false inside notice window', () => {
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T14:30:00Z'), 60)).toBe(false);
	});

	test('false for terminal status', () => {
		expect(
			isRescheduleAllowed({ ...baseRow, status: 'declined' }, new Date('2026-05-01T13:00:00Z'), 60)
		).toBe(false);
	});

	test('zero minimum_notice still requires now <= start', () => {
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T15:00:00Z'), 0)).toBe(true);
		expect(isRescheduleAllowed(baseRow, new Date('2026-05-01T15:00:01Z'), 0)).toBe(false);
	});
});

describe('requireViewableAppointment', () => {
	const now = new Date('2026-05-01T14:00:00Z');

	test('returns row on happy path', () => {
		expect(requireViewableAppointment(baseRow, 'tok-abc', now)).toBe(baseRow);
	});

	test('passes through terminal statuses (caller decides)', () => {
		const cancelled = { ...baseRow, status: 'cancelled' as const };
		expect(requireViewableAppointment(cancelled, 'tok-abc', now)).toBe(cancelled);
		const declined = { ...baseRow, status: 'declined' as const };
		expect(requireViewableAppointment(declined, 'tok-abc', now)).toBe(declined);
	});

	test('throws 404 when row missing', () => {
		expect(() => requireViewableAppointment(undefined, 'tok-abc', now)).toThrow();
	});

	test('throws 404 when token missing', () => {
		expect(() => requireViewableAppointment(baseRow, null, now)).toThrow();
	});

	test('throws 404 on token mismatch', () => {
		expect(() => requireViewableAppointment(baseRow, 'wrong', now)).toThrow();
	});

	test('throws 404 past grace window', () => {
		const past = new Date(Date.parse(baseRow.end_time) + (BOOKING_VIEW_GRACE_DAYS + 1) * DAY_MS);
		expect(() => requireViewableAppointment(baseRow, 'tok-abc', past)).toThrow();
	});
});
