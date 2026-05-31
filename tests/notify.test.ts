import { beforeEach, expect, test, vi } from 'vitest';
import type { Appointment } from '../src/lib/server/db';
import { validConfig } from './fixtures/valid-config';

// Hoisted so the vi.mock factory below can reference it. One shared mock,
// cleared between tests.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const sendEmail = vi.hoisted(() => vi.fn(async (_opts: unknown) => ({ ok: true as const })));
vi.mock('../src/lib/server/smtp', () => ({ sendEmail }));

beforeEach(() => {
	sendEmail.mockClear();
});

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
	external_event_id: null,
	external_calendar_id: null,
	notification_status: null,
	ics_sequence: 0,
	created_at: '',
	updated_at: ''
};

const smtp = { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p' };
const bookedUrl = 'https://when.example.com/booked/appt-1?token=tok';
const cancelUrl = 'https://when.example.com/booked/appt-1?token=tok&cancel=1';
const rescheduleUrl = 'https://when.example.com/schedule/30-min?reschedule=appt-1&token=tok';

function stubSendEmail() {
	return sendEmail;
}

test('notify(booking_confirmed) sends correct attendee email', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_confirmed', {
		cfg: { ...validConfig, smtp },
		appointment,
		eventType: validConfig.event_types[0],
		cancelUrl,
		rescheduleUrl,
		bookedUrl
	});

	expect(sendStub).toHaveBeenCalledTimes(2);
	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.to).toBe('booker@example.com');
	expect(attendeeCall.subject).toContain('Confirmed');
	expect(attendeeCall.subject).toContain('30 Minute Chat');
	expect(attendeeCall.text).toContain(`Cancel: ${cancelUrl}`);
	expect(attendeeCall.text).toContain(`Reschedule: ${rescheduleUrl}`);
	expect(attendeeCall.attachments).toHaveLength(1);
	const att = (attendeeCall.attachments as Array<Record<string, unknown>>)[0];
	expect(att.filename).toBe('appt-1.ics');
	expect(att.contentType).toBe('text/calendar; charset=utf-8');
	expect(att.content).toContain('BEGIN:VCALENDAR');
	// ICS folds long lines at column 75 with `\r\n `; unfold before substring match.
	const unfolded = (att.content as string).replace(/\r\n /g, '');
	expect(unfolded).toContain(bookedUrl);

	// HTML wired through
	expect(attendeeCall.html).toContain('<!doctype html>');
	expect(attendeeCall.html).toContain(cancelUrl.replace(/&/g, '&amp;'));
	expect(attendeeCall.html).toContain(rescheduleUrl.replace(/&/g, '&amp;'));
});

test('notify(booking_cancelled_by_attendee) attaches METHOD:CANCEL ICS for attendee, admin gets none', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_cancelled_by_attendee', {
		cfg: { ...validConfig, smtp },
		appointment: { ...appointment, status: 'cancelled', ics_sequence: 1 },
		eventType: validConfig.event_types[0],
		cancelUrl,
		rescheduleUrl,
		bookedUrl
	});

	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.subject).toContain('Cancelled');
	expect(attendeeCall.text).not.toContain('Cancel:');
	expect(attendeeCall.attachments).toHaveLength(1);
	const att = (attendeeCall.attachments as Array<Record<string, unknown>>)[0];
	expect(att.filename).toBe('appt-1.ics');
	expect(att.content).toContain('METHOD:CANCEL');
	expect(att.content).toContain('STATUS:CANCELLED');
	expect(att.content).toMatch(/^SEQUENCE:1$/m);
	expect(att.content).toContain('UID:appt-1');

	// Admin's calendar is updated via deleteAppointmentFromCalendar, not email.
	const adminCall = sendStub.mock.calls[1]![0] as Record<string, unknown>;
	expect(adminCall.attachments).toBeUndefined();
});

test('notify(booking_cancelled_by_organizer) tells attendee the organizer cancelled and attaches METHOD:CANCEL ICS', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_cancelled_by_organizer', {
		cfg: { ...validConfig, smtp },
		appointment: { ...appointment, status: 'cancelled', ics_sequence: 1 },
		eventType: validConfig.event_types[0],
		cancelUrl,
		rescheduleUrl,
		bookedUrl
	});

	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.to).toBe('booker@example.com');
	expect(attendeeCall.subject).toContain('Cancelled');
	expect(attendeeCall.text).toContain(`${validConfig.user.name} cancelled this booking.`);
	expect(attendeeCall.attachments).toHaveLength(1);
	const att = (attendeeCall.attachments as Array<Record<string, unknown>>)[0];
	expect(att.content).toContain('METHOD:CANCEL');
	expect(att.content).toMatch(/^SEQUENCE:1$/m);

	const adminCall = sendStub.mock.calls[1]![0] as Record<string, unknown>;
	expect(adminCall.to).toBe(validConfig.user.email);
	expect(adminCall.subject).toContain('Cancelled');
	expect(adminCall.text).toContain('You cancelled');
	expect(adminCall.attachments).toBeUndefined();
});

test('notify(booking_rescheduled_by_attendee) sends attendee email with ICS', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_rescheduled_by_attendee', {
		cfg: { ...validConfig, smtp },
		appointment,
		eventType: validConfig.event_types[0],
		cancelUrl,
		rescheduleUrl,
		bookedUrl
	});

	expect(sendStub).toHaveBeenCalledTimes(2);
	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.subject).toContain('Rescheduled');
	expect(attendeeCall.text).toContain(`Reschedule again: ${rescheduleUrl}`);
	expect(attendeeCall.text).toContain(`Cancel: ${cancelUrl}`);
	expect(attendeeCall.attachments).toHaveLength(1);
});

test('notify(booking_rescheduled_by_organizer) tells attendee the organizer moved the booking and attaches REQUEST ICS', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_rescheduled_by_organizer', {
		cfg: { ...validConfig, smtp },
		appointment: { ...appointment, ics_sequence: 1 },
		eventType: validConfig.event_types[0],
		cancelUrl,
		rescheduleUrl,
		bookedUrl
	});

	expect(sendStub).toHaveBeenCalledTimes(2);
	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.to).toBe('booker@example.com');
	expect(attendeeCall.subject).toContain('Rescheduled');
	expect(attendeeCall.text).toContain(`${validConfig.user.name} moved this booking to a new time.`);
	expect(attendeeCall.text).toContain(`Reschedule: ${rescheduleUrl}`);
	expect(attendeeCall.text).toContain(`Cancel: ${cancelUrl}`);
	expect(attendeeCall.attachments).toHaveLength(1);
	const att = (attendeeCall.attachments as Array<Record<string, unknown>>)[0];
	expect(att.content).toContain('METHOD:REQUEST');
	expect(att.content).toMatch(/^SEQUENCE:1$/m);

	const adminCall = sendStub.mock.calls[1]![0] as Record<string, unknown>;
	expect(adminCall.to).toBe(validConfig.user.email);
	expect(adminCall.text).toContain('You rescheduled');
	expect(adminCall.attachments).toBeUndefined();
});

test('notify(booking_pending_to_attendee) sends acknowledgement to attendee with cancel + reschedule, no ICS', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_pending_to_attendee', {
		cfg: { ...validConfig, smtp },
		appointment: { ...appointment, status: 'pending' },
		eventType: validConfig.event_types[0],
		cancelUrl,
		rescheduleUrl,
		bookedUrl
	});

	expect(sendStub).toHaveBeenCalledTimes(1);
	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.to).toBe('booker@example.com');
	expect(attendeeCall.subject).toContain('Booking request received');
	expect(attendeeCall.text).toContain(`Cancel: ${cancelUrl}`);
	expect(attendeeCall.text).toContain(`Reschedule: ${rescheduleUrl}`);
	expect(attendeeCall.attachments).toBeUndefined();
});

test('notify(booking_pending_to_organizer) sends accept/decline email to organizer only', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	const manageUrl = 'https://when.example.com/signin?callbackUrl=%2Fbooked%2Fappt-1';
	await notify('booking_pending_to_organizer', {
		cfg: { ...validConfig, smtp },
		appointment: { ...appointment, status: 'pending' },
		eventType: validConfig.event_types[0],
		cancelUrl,
		rescheduleUrl,
		bookedUrl,
		manageUrl
	});

	expect(sendStub).toHaveBeenCalledTimes(1);
	const organizerCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(organizerCall.to).toBe(validConfig.user.email);
	expect(organizerCall.subject).toContain('Booking request');
	expect(organizerCall.text).toContain(manageUrl);
	expect(organizerCall.attachments).toBeUndefined();
});

test('notify(booking_declined) sends to attendee and admin, no ICS', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	await notify('booking_declined', {
		cfg: { ...validConfig, smtp },
		appointment: { ...appointment, status: 'declined' },
		eventType: validConfig.event_types[0],
		cancelUrl: '',
		rescheduleUrl: '',
		bookedUrl: ''
	});

	expect(sendStub).toHaveBeenCalledTimes(2);
	const attendeeCall = sendStub.mock.calls[0]![0] as Record<string, unknown>;
	expect(attendeeCall.to).toBe('booker@example.com');
	expect(attendeeCall.subject).toContain('Declined');
	expect(attendeeCall.text).toContain('declined');
	expect(attendeeCall.attachments).toBeUndefined();

	const adminCall = sendStub.mock.calls[1]![0] as Record<string, unknown>;
	expect(adminCall.to).toBe(validConfig.user.email);
	expect(adminCall.subject).toContain('Declined');
	expect(adminCall.text).toContain('You declined');
	expect(adminCall.attachments).toBeUndefined();
});

test('every variant fires sendEmail with a populated html body', async () => {
	const variants = [
		'booking_confirmed',
		'booking_pending_to_attendee',
		'booking_pending_to_organizer',
		'booking_cancelled_by_attendee',
		'booking_cancelled_by_organizer',
		'booking_rescheduled_by_attendee',
		'booking_rescheduled_by_organizer',
		'booking_declined'
	] as const;
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	for (const variant of variants) {
		await notify(variant, {
			cfg: { ...validConfig, smtp },
			appointment: { ...appointment, status: 'pending' },
			eventType: validConfig.event_types[0],
			cancelUrl,
			rescheduleUrl,
			bookedUrl,
			manageUrl: 'https://when.example.com/manage'
		});
	}
	const calls = sendStub.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	for (const call of calls) {
		const env = call[0] as Record<string, unknown>;
		expect(env.html).toBeTruthy();
		expect(env.html).toContain('<!doctype html>');
		expect(env.html).toContain('Powered by When');
	}
});

test('notify returns ok:true skipped:true when SMTP is not configured', async () => {
	const sendStub = stubSendEmail();
	const { notify } = await import('../src/lib/server/notify');
	const result = await notify('booking_confirmed', {
		cfg: { ...validConfig, smtp: undefined },
		appointment,
		eventType: validConfig.event_types[0],
		cancelUrl,
		rescheduleUrl,
		bookedUrl
	});

	expect(result).toEqual({ ok: true, skipped: true });
	expect(sendStub).not.toHaveBeenCalled();
});
