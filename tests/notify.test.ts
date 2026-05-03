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
	created_at: '',
	updated_at: ''
};

const smtp = { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p' };
const cancelUrl = 'https://when.example.com/booked/appt-1?token=tok';

test('notifyBookingConfirmed sends correct attendee email', async () => {
	const sendStub = mock((_opts: unknown) => Promise.resolve({ ok: true } as const));
	mock.module('../src/lib/server/smtp', () => ({ sendEmail: sendStub }));

	const { notifyBookingConfirmed } = await import('../src/lib/server/notify');
	await notifyBookingConfirmed({
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

test('notifyBookingCancelled does not include cancel link', async () => {
	const sendStub = mock((_opts: unknown) => Promise.resolve({ ok: true } as const));
	mock.module('../src/lib/server/smtp', () => ({ sendEmail: sendStub }));

	const { notifyBookingCancelled } = await import('../src/lib/server/notify');
	await notifyBookingCancelled({
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

test('notifyBookingRescheduled sends attendee email with ICS', async () => {
	const sendStub = mock((_opts: unknown) => Promise.resolve({ ok: true } as const));
	mock.module('../src/lib/server/smtp', () => ({ sendEmail: sendStub }));

	const { notifyBookingRescheduled } = await import('../src/lib/server/notify');
	await notifyBookingRescheduled({
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

test('notify returns ok:true skipped:true when SMTP is not configured', async () => {
	const sendStub = mock((_opts: unknown) => Promise.resolve({ ok: true } as const));
	mock.module('../src/lib/server/smtp', () => ({ sendEmail: sendStub }));

	const { notifyBookingConfirmed } = await import('../src/lib/server/notify');
	const result = await notifyBookingConfirmed({
		cfg: { ...validConfig, smtp: undefined },
		appointment,
		eventType: validConfig.event_types[0],
		cancelUrl
	});

	expect(result).toEqual({ ok: true, skipped: true });
	expect(sendStub).not.toHaveBeenCalled();
});
