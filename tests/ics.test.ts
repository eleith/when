import { expect, test } from 'vitest';
import { buildIcs } from '$lib/server/ics';
import type { Appointment } from '$lib/server/db';

const baseAppointment: Appointment = {
	id: 'appt-123',
	event_type_id: 'chat',
	start_time: '2026-04-27T13:00:00Z',
	end_time: '2026-04-27T13:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: null,
	status: 'confirmed',
	cancel_token: 'tok-abc',
	external_event_id: null,
	external_calendar_id: null,
	notification_status: null,
	ics_sequence: 0,
	created_at: '2026-04-25T10:00:00Z',
	updated_at: '2026-04-25T10:00:00Z'
};

const baseInput = {
	eventTypeName: 'Chat',
	organizerName: 'Jane Doe',
	organizerEmail: 'jane@example.com',
	cancelUrl: 'https://when.example.com/booked/appt-123?token=tok-abc',
	method: 'REQUEST' as const
};

test('produces a VCALENDAR with the appointment as a VEVENT', () => {
	const ics = buildIcs({ appointment: baseAppointment, ...baseInput });
	expect(ics).toContain('BEGIN:VCALENDAR');
	expect(ics).toContain('END:VCALENDAR');
	expect(ics).toContain('BEGIN:VEVENT');
	expect(ics).toContain('END:VEVENT');
	expect(ics).toContain('UID:appt-123');
	expect(ics).toContain('SUMMARY:Chat');
});

test('DTSTART/DTEND match the appointment times', () => {
	const ics = buildIcs({ appointment: baseAppointment, ...baseInput });
	expect(ics).toContain('20260427T130000Z');
	expect(ics).toContain('20260427T133000Z');
});

test('LOCATION is set when the appointment has one', () => {
	const ics = buildIcs({
		appointment: { ...baseAppointment, location: 'Coffee shop on Main St' },
		...baseInput
	});
	expect(ics).toContain('LOCATION:Coffee shop on Main St');
});

test('LOCATION is omitted when the appointment has none', () => {
	const ics = buildIcs({ appointment: baseAppointment, ...baseInput });
	expect(ics).not.toMatch(/^LOCATION:/m);
});

test('DESCRIPTION contains the cancel URL', () => {
	const ics = buildIcs({ appointment: baseAppointment, ...baseInput });
	expect(ics).toContain('https://when.example.com/booked/appt-123');
});

test('DESCRIPTION includes attendee notes when present', () => {
	const ics = buildIcs({
		appointment: { ...baseAppointment, attendee_notes: 'Looking forward to chatting!' },
		...baseInput
	});
	expect(ics).toContain('Looking forward to chatting');
});

test('STATUS reflects pending appointments', () => {
	const ics = buildIcs({
		appointment: { ...baseAppointment, status: 'pending' },
		...baseInput
	});
	expect(ics).toContain('STATUS:TENTATIVE');
});

test('STATUS is CONFIRMED for confirmed appointments', () => {
	const ics = buildIcs({ appointment: baseAppointment, ...baseInput });
	expect(ics).toContain('STATUS:CONFIRMED');
});

test('ORGANIZER and ATTENDEE lines are present', () => {
	const ics = buildIcs({ appointment: baseAppointment, ...baseInput });
	expect(ics).toMatch(/ORGANIZER[;:][^\r\n]*jane@example\.com/);
	expect(ics).toMatch(/ATTENDEE[;:][^\r\n]*booker@example\.com/);
});

test('METHOD:REQUEST is emitted at the calendar level for create/reschedule', () => {
	const ics = buildIcs({ appointment: baseAppointment, ...baseInput });
	expect(ics).toContain('METHOD:REQUEST');
});

test('METHOD:CANCEL is emitted when method is CANCEL, with STATUS:CANCELLED', () => {
	const ics = buildIcs({ appointment: baseAppointment, ...baseInput, method: 'CANCEL' });
	expect(ics).toContain('METHOD:CANCEL');
	expect(ics).toContain('STATUS:CANCELLED');
});

test('SEQUENCE matches appointment.ics_sequence', () => {
	const ics0 = buildIcs({ appointment: baseAppointment, ...baseInput });
	expect(ics0).toMatch(/^SEQUENCE:0$/m);

	const ics3 = buildIcs({
		appointment: { ...baseAppointment, ics_sequence: 3 },
		...baseInput
	});
	expect(ics3).toMatch(/^SEQUENCE:3$/m);
});

test('omits METHOD when method is undefined (CalDAV calendar object resource)', () => {
	const ics = buildIcs({ appointment: baseAppointment, ...baseInput, method: undefined });
	expect(ics).not.toMatch(/^METHOD:/m);
	// STATUS still derives from appointment.status.
	expect(ics).toContain('STATUS:CONFIRMED');
	expect(ics).toContain('UID:appt-123');
});

test('UID is stable across REQUEST and CANCEL for the same appointment', () => {
	const create = buildIcs({ appointment: baseAppointment, ...baseInput });
	const cancel = buildIcs({
		appointment: { ...baseAppointment, ics_sequence: 1 },
		...baseInput,
		method: 'CANCEL'
	});
	const uidLine = (ics: string) => ics.match(/^UID:.+$/m)?.[0];
	expect(uidLine(create)).toBe('UID:appt-123');
	expect(uidLine(cancel)).toBe('UID:appt-123');
});
