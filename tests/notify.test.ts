import { expect, test } from 'bun:test';
import {
	notifyBookingCancelled,
	notifyBookingConfirmed,
	notifyBookingRescheduled
} from '../src/lib/server/notify';
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

const eventType = validConfig.event_types[0];
const ctxBase = {
	cfg: { ...validConfig, smtp: undefined },
	appointment,
	eventType,
	cancelUrl: 'https://when.example.com/booked/appt-1?token=tok'
};

test('notifyBookingConfirmed skips when SMTP is not configured', async () => {
	const result = await notifyBookingConfirmed(ctxBase);
	expect(result).toEqual({ ok: true, skipped: true });
});

test('notifyBookingCancelled skips when SMTP is not configured', async () => {
	const result = await notifyBookingCancelled(ctxBase);
	expect(result).toEqual({ ok: true, skipped: true });
});

test('notifyBookingRescheduled skips when SMTP is not configured', async () => {
	const result = await notifyBookingRescheduled(ctxBase);
	expect(result).toEqual({ ok: true, skipped: true });
});
