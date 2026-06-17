import { expect, test } from 'vitest';
import { deriveDisplayStatus, toAppointmentView } from './appointments';
import type { Appointment } from '@when/db';
import type { WhenConfiguration } from '@when/config';

test('deriveDisplayStatus works for non-confirmed statuses', () => {
	const now = new Date('2026-06-15T12:00:00Z');
	expect(deriveDisplayStatus({ status: 'pending', start_time: '', end_time: '' }, now)).toBe('pending');
	expect(deriveDisplayStatus({ status: 'cancelled', start_time: '', end_time: '' }, now)).toBe('cancelled');
});

test('deriveDisplayStatus classifies confirmed statuses by time', () => {
	const now = new Date('2026-06-15T12:00:00Z');

	// Confirmed future
	expect(
		deriveDisplayStatus(
			{ status: 'confirmed', start_time: '2026-06-15T13:00:00Z', end_time: '2026-06-15T14:00:00Z' },
			now
		)
	).toBe('confirmed');

	// Confirmed in-progress
	expect(
		deriveDisplayStatus(
			{ status: 'confirmed', start_time: '2026-06-15T11:00:00Z', end_time: '2026-06-15T13:00:00Z' },
			now
		)
	).toBe('in_progress');

	// Confirmed concluded
	expect(
		deriveDisplayStatus(
			{ status: 'confirmed', start_time: '2026-06-15T10:00:00Z', end_time: '2026-06-15T11:00:00Z' },
			now
		)
	).toBe('concluded');
});

test('toAppointmentView enriches appointment rows correctly', () => {
	const now = new Date('2026-06-15T12:00:00Z');
	const mockRow: Appointment = {
		id: 'a1',
		event_type_id: 'chat-30',
		start_time: '2026-06-15T13:00:00Z',
		end_time: '2026-06-15T13:30:00Z',
		attendee_name: 'Jane Doe',
		attendee_email: 'jane@example.com',
		attendee_notes: 'Hello',
		attendee_timezone: 'UTC',
		location: 'Zoom',
		status: 'confirmed',
		origin_id: null,
		rescheduled_from_id: null,
		rescheduled_to_id: null,
		cancel_token: 'tok-a1',
		external_event_id: null,
		external_calendar_id: null,
		email_notification_status: null,
		calendar_push_notification_status: null,
		calendar_revision: 1,
		calendar_synced_revision: null,
		has_possible_conflict: 1,
		calendar_push_failing_since: null,
		ics_sequence: 0,
		created_at: '',
		updated_at: ''
	};

	const mockCfg: WhenConfiguration = {
		event_types: [
			{ id: 'chat-30', name: '30 Minute Chat', duration_minutes: 30, slug: 'chat-30' }
		]
	} as any;

	const view = toAppointmentView(mockRow, mockCfg, now);
	expect(view.event_type_name).toBe('30 Minute Chat');
	expect(view.display_status).toBe('confirmed');
	expect(view.is_past).toBe(false);
	expect(view.possible_conflict).toBe(true);
});
