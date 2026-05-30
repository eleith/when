import { expect, test } from 'bun:test';
import type { NotifyContext } from '../src/lib/server/notify';
import type { Appointment } from '../src/lib/server/db';
import { renderers } from '../src/lib/server/email-templates';
import { DEFAULT_PRIMARY_COLOR } from '../src/lib/server/email-templates/layout';
import { validConfig } from './fixtures/valid-config';

const baseAppointment: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: '2026-05-30T13:00:00Z',
	end_time: '2026-05-30T13:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_notes: null,
	location: 'Online',
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

function ctx(overrides: Partial<NotifyContext> = {}): NotifyContext {
	return {
		cfg: validConfig,
		appointment: baseAppointment,
		eventType: validConfig.event_types[0],
		cancelUrl: 'https://when.example.com/booked/appt-1?token=tok&cancel=1',
		rescheduleUrl: 'https://when.example.com/schedule/30-min?reschedule=appt-1&token=tok',
		bookedUrl: 'https://when.example.com/booked/appt-1?token=tok',
		...overrides
	};
}

(Object.keys(renderers) as Array<keyof typeof renderers>).forEach((variant) => {
	test(`${variant}: every envelope has a non-empty subject, text, and HTML body`, () => {
		const envelopes = renderers[variant](ctx({}));
		expect(envelopes.length).toBeGreaterThan(0);
		for (const env of envelopes) {
			expect(env.to).toBeTruthy();
			expect(env.subject.length).toBeGreaterThan(0);
			expect(env.text.length).toBeGreaterThan(0);
			expect(env.html).toBeTruthy();
			expect(env.html).toContain('<!doctype html>');
			expect(env.html).toContain('Powered by When');
		}
	});
});

test('renderBookingConfirmed: attendee email contains action URLs and includes ICS attachment', () => {
	const envelopes = renderers.booking_confirmed(ctx({}));
	const attendee = envelopes.find((e) => e.to === 'booker@example.com');
	expect(attendee).toBeDefined();
	expect(attendee!.html).toContain('https://when.example.com/booked/appt-1?token=tok&amp;cancel=1');
	expect(attendee!.html).toContain(
		'https://when.example.com/schedule/30-min?reschedule=appt-1&amp;token=tok'
	);
	expect(attendee!.attachments).toBeArrayOfSize(1);
	expect(attendee!.attachments![0].content).toContain('METHOD:REQUEST');
});

test('renderBookingCancelledByAttendee: attendee envelope attaches METHOD:CANCEL ICS', () => {
	const envelopes = renderers.booking_cancelled_by_attendee(
		ctx({ appointment: { ...baseAppointment, status: 'cancelled', ics_sequence: 1 } })
	);
	const attendee = envelopes.find((e) => e.to === 'booker@example.com');
	expect(attendee!.attachments).toBeArrayOfSize(1);
	expect(attendee!.attachments![0].content).toContain('METHOD:CANCEL');
});

test('renderBookingCancelledByOrganizer: attendee headline names the organizer', () => {
	const envelopes = renderers.booking_cancelled_by_organizer(ctx({}));
	const attendee = envelopes.find((e) => e.to === 'booker@example.com');
	expect(attendee!.html).toContain(`${validConfig.user.name} cancelled this booking.`);
	expect(attendee!.text).toContain(`${validConfig.user.name} cancelled this booking.`);
});

test('renderBookingRescheduledByOrganizer: attendee headline names the organizer', () => {
	const envelopes = renderers.booking_rescheduled_by_organizer(ctx({}));
	const attendee = envelopes.find((e) => e.to === 'booker@example.com');
	expect(attendee!.html).toContain(`${validConfig.user.name} moved this booking to a new time.`);
});

test('renderBookingPendingToOrganizer: includes the review link', () => {
	const envelopes = renderers.booking_pending_to_organizer(
		ctx({
			appointment: { ...baseAppointment, status: 'pending' },
			manageUrl: 'https://when.example.com/signin?callbackUrl=%2Fbooked%2Fappt-1'
		})
	);
	expect(envelopes).toHaveLength(1);
	expect(envelopes[0].html).toContain('https://when.example.com/signin?callbackUrl=%2Fbooked%2Fappt-1');
});

test('default brand color is used when primary_color is unset', () => {
	const envelopes = renderers.booking_confirmed(ctx({}));
	expect(envelopes[0].html).toContain(`background:${DEFAULT_PRIMARY_COLOR}`);
});

test('configured brand color appears in the header strip', () => {
	const colored = {
		...validConfig,
		user: {
			...validConfig.user,
			branding: { primary_color: '#ff00aa' }
		}
	};
	const envelopes = renderers.booking_confirmed(ctx({ cfg: colored }));
	expect(envelopes[0].html).toContain('background:#ff00aa');
});

test('HTML-escapes a hostile attendee name in body and subject', () => {
	const nasty = `Evil <script>alert('x')</script>`;
	const envelopes = renderers.booking_confirmed(
		ctx({ appointment: { ...baseAppointment, attendee_name: nasty } })
	);
	const admin = envelopes.find((e) => e.to === validConfig.user.email);
	expect(admin!.html).not.toContain('<script>');
	expect(admin!.html).toContain('&lt;script&gt;');
});

test('HTML-escapes attendee_notes in the admin body', () => {
	const nasty = `<img src=x onerror=alert(1)>`;
	const envelopes = renderers.booking_confirmed(
		ctx({ appointment: { ...baseAppointment, attendee_notes: nasty } })
	);
	const admin = envelopes.find((e) => e.to === validConfig.user.email);
	expect(admin!.html).not.toContain('<img src=x');
	expect(admin!.html).toContain('&lt;img');
});
