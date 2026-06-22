import { describe, expect, test } from 'vitest';
import { buildIcs, cancelIcs, requestIcs } from './ics.js';
import { sampleAppointment, sampleInput } from './__fixtures__/appointment.js';

const clock = { now: () => new Date('2026-01-01T00:00:00Z'), nowMs: () => 0 };

describe('ics', () => {
	test('buildIcs emits a REQUEST calendar for a confirmed event', () => {
		const ics = buildIcs({
			appointment: sampleAppointment,
			eventTypeName: '30 Minute Chat',
			hostName: 'Acme',
			hostEmail: 'owner@acme.test',
			cancelUrl: 'https://when.example.com/appointment/appt-1',
			method: 'REQUEST',
			clock
		});
		expect(ics).toContain('BEGIN:VCALENDAR');
		expect(ics).toContain('METHOD:REQUEST');
		expect(ics).toContain('UID:appt-1');
		expect(ics).toContain('STATUS:CONFIRMED');
		expect(ics).toContain('Reschedule or cancel'); // cancelUrl description (URL itself is line-folded)
	});

	test('requestIcs and cancelIcs produce .ics attachments', () => {
		const req = requestIcs(sampleInput, sampleInput.links.booked);
		expect(req.filename).toBe('invite.ics');
		expect(req.contentType).toMatch(/text\/calendar/);
		expect(req.content).toContain('METHOD:REQUEST');

		const cancel = cancelIcs(sampleInput, sampleInput.links.booked);
		expect(cancel.content).toContain('METHOD:CANCEL');
		expect(cancel.content).toContain('STATUS:CANCELLED');
	});

	test('guest-facing ics organizes as the sender, never the host email', () => {
		// ts-ics line-folds long property values; unfold before matching.
		const unfold = (s: string) => s.replace(/\r\n[ \t]/g, '');
		const req = unfold(requestIcs(sampleInput, sampleInput.links.booked).content);
		const cancel = unfold(cancelIcs(sampleInput, sampleInput.links.booked).content);
		// url.app is https://when.example.com and no smtp.from is set.
		expect(req).toContain('noreply@when.example.com');
		expect(req).not.toContain('owner@acme.test');
		expect(cancel).not.toContain('owner@acme.test');
		// Guest is pre-accepted so clients don't prompt an RSVP to the noreply organizer.
		expect(req).toContain('PARTSTAT=ACCEPTED');
		expect(req).toContain('RSVP=FALSE');
	});
});
