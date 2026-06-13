import { describe, expect, test } from 'vitest';
import { bookingConfirmed } from './booking-confirmed.js';
import { sampleInput } from '../__fixtures__/booking.js';

describe('bookingConfirmed', () => {
	test('builds the attendee and organizer envelopes (html + text)', async () => {
		const [attendee, organizer] = await bookingConfirmed(sampleInput);

		const html = attendee.html ?? '';
		expect(attendee.to).toBe('jane@example.com');
		expect(attendee.subject).toBe('Confirmed: 30-min with Acme Scheduling');
		expect(html.toLowerCase()).toContain('<!doctype html');
		expect(html).toContain('Acme Scheduling');
		expect(html).toContain('Your booking is confirmed');
		expect(html).toContain('Zoom');
		expect(html).toContain(sampleInput.links.reschedule);
		expect(html).toContain('#2563eb');
		expect(attendee.attachments?.[0].filename).toBe('invite.ics');

		expect(attendee.text.startsWith('Your booking is confirmed.\n\nWhat: 30-min\nWhen: ')).toBe(
			true
		);
		expect(attendee.text).toContain('\nWhere: Zoom\n\n');
		expect(attendee.text).toContain(
			`Reschedule: ${sampleInput.links.reschedule}\nCancel: ${sampleInput.links.cancel}`
		);

		expect(organizer.to).toBe('owner@acme.test');
		expect(organizer.subject).toBe('New booking: 30-min with Jane Doe');
		expect(organizer.html ?? '').toContain('Jane Doe &lt;jane@example.com&gt;');
		expect(organizer.text).toContain('Jane Doe <jane@example.com> just booked.');
		expect(organizer.text).toContain('Notes: Looking forward to it');
		expect(organizer.attachments).toBeUndefined();
	});

	test('references the embedded logo by cid in the header', async () => {
		const withLogo = {
			...sampleInput,
			cfg: {
				...sampleInput.cfg,
				user: { ...sampleInput.cfg.user, branding: { primary_color: '#16a34a' } }
			},
			logo: {
				filename: 'logo.png',
				content: 'AAAA',
				contentType: 'image/png',
				cid: 'brand-logo',
				encoding: 'base64'
			}
		};
		const [attendee] = await bookingConfirmed(withLogo);
		const html = attendee.html ?? '';
		expect(html).toContain('src="cid:brand-logo"');
		expect(html).toContain('#16a34a');
	});
});
