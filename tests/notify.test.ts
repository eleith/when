import { expect, mock, test } from 'bun:test';
import type { Appointment } from '../src/lib/server/db';
import { validConfig } from './fixtures/valid-config';

const appointment: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: '2026-04-27T13:00:00Z',
	end_time: '2026-04-27T13:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: null,
	status: 'confirmed',
	cancel_token: 'tok',
	response_token: null,
	external_event_id: null,
	external_calendar_id: null,
	notification_status: null,
	ics_sequence: 0,
	created_at: '',
	updated_at: ''
};

const smtp = { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p' };
const cancelUrl = 'https://when.example.com/booked/appt-1?token=tok';

function stubSendEmail() {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const s = mock((_opts: unknown) => Promise.resolve({ ok: true } as const));
	mock.module('../src/lib/server/smtp', () => ({ sendEmail: s }));
	return s;
}

test('notify(booking_confirmed) sends correct attendee email', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_confirmed', {
		cfg: { ...validConfig, smtp },
		appointment,
		eventType: validConfig.event_types[0],
		cancelUrl
	});

	expect(sendStub).toHaveBeenCalledTimes(2);
	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.to).toBe('booker@example.com');
	expect(attendeeCall.subject).toContain('Confirmed');
	expect(attendeeCall.subject).toContain('30 Minute Chat');
	expect(attendeeCall.text).toContain('Cancel or reschedule:');
	expect(attendeeCall.text).toContain(cancelUrl);
	expect(attendeeCall.attachments).toBeArrayOfSize(1);
	const att = (attendeeCall.attachments as Array<Record<string, unknown>>)[0];
	expect(att.filename).toBe('appt-1.ics');
	expect(att.contentType).toBe('text/calendar; charset=utf-8');
	expect(att.content).toContain('BEGIN:VCALENDAR');
});

test('notify(booking_cancelled_by_attendee) does not include cancel link', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_cancelled_by_attendee', {
		cfg: { ...validConfig, smtp },
		appointment,
		eventType: validConfig.event_types[0],
		cancelUrl
	});

	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.subject).toContain('Cancelled');
	expect(attendeeCall.text).not.toContain('Cancel');
	expect(attendeeCall.attachments).toBeUndefined();
});

test('notify(booking_rescheduled_by_attendee) sends attendee email with ICS', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_rescheduled_by_attendee', {
		cfg: { ...validConfig, smtp },
		appointment,
		eventType: validConfig.event_types[0],
		cancelUrl
	});

	expect(sendStub).toHaveBeenCalledTimes(2);
	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.subject).toContain('Rescheduled');
	expect(attendeeCall.attachments).toBeArrayOfSize(1);
});

test('notify(booking_pending_to_attendee) sends acknowledgement to attendee with cancel + reschedule, no ICS', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	const rescheduleUrl = 'https://when.example.com/schedule/chat?reschedule=appt-1&token=tok';
	await notify('booking_pending_to_attendee', {
		cfg: { ...validConfig, smtp },
		appointment: { ...appointment, status: 'pending' },
		eventType: validConfig.event_types[0],
		cancelUrl,
		rescheduleUrl
	});

	expect(sendStub).toHaveBeenCalledTimes(1);
	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.to).toBe('booker@example.com');
	expect(attendeeCall.subject).toContain('Booking request received');
	expect(attendeeCall.text).toContain(cancelUrl);
	expect(attendeeCall.text).toContain(rescheduleUrl);
	expect(attendeeCall.attachments).toBeUndefined();
});

test('notify(booking_pending_to_organizer) sends accept/decline email to organizer only', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	const acceptUrl = 'https://when.example.com/admin/respond/appt-1?action=accept&token=rt';
	const declineUrl = 'https://when.example.com/admin/respond/appt-1?action=decline&token=rt';
	await notify('booking_pending_to_organizer', {
		cfg: { ...validConfig, smtp },
		appointment: { ...appointment, status: 'pending' },
		eventType: validConfig.event_types[0],
		cancelUrl,
		acceptUrl,
		declineUrl
	});

	expect(sendStub).toHaveBeenCalledTimes(1);
	const organizerCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(organizerCall.to).toBe(validConfig.user.email);
	expect(organizerCall.subject).toContain('Booking request');
	expect(organizerCall.text).toContain(acceptUrl);
	expect(organizerCall.text).toContain(declineUrl);
	expect(organizerCall.attachments).toBeUndefined();
});

test('notify returns ok:true skipped:true when SMTP is not configured', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	const result = await notify('booking_confirmed', {
		cfg: { ...validConfig, smtp: undefined },
		appointment,
		eventType: validConfig.event_types[0],
		cancelUrl
	});

	expect(result).toEqual({ ok: true, skipped: true });
	expect(sendStub).not.toHaveBeenCalled();
});
