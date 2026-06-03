import { describe, expect, test } from 'vitest';
import { attendeeEnvelope, organizerEnvelope } from './recipients.js';
import { sampleInput } from './__fixtures__/booking.js';

const spec = { subject: 'S', html: '<p>h</p>', text: 't' };

describe('recipients', () => {
	test('attendeeEnvelope addresses the attendee', () => {
		expect(attendeeEnvelope(sampleInput, spec).to).toBe('jane@example.com');
	});

	test('organizerEnvelope addresses the configured user', () => {
		expect(organizerEnvelope(sampleInput, spec).to).toBe('owner@acme.test');
	});

	test('an ics spec becomes an attachment; otherwise none', () => {
		expect(organizerEnvelope(sampleInput, spec).attachments).toBeUndefined();
		const ics = { filename: 'x.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' };
		expect(attendeeEnvelope(sampleInput, { ...spec, ics }).attachments).toEqual([ics]);
	});
});
