import { describe, expect, test } from 'vitest';
import { attendeeMessage, organizerMessage } from './recipients.js';
import { sampleInput } from './__fixtures__/booking.js';
import type { EmailContent } from './content.js';

const content: EmailContent = {
	brand: { name: 'Acme', pageTitle: 'Acme', primaryColor: '#2563eb', onPrimary: '#ffffff' },
	subject: 'S',
	heading: 'H',
	paragraphs: [],
	rows: [],
	actions: []
};

describe('recipients', () => {
	test('attendeeMessage addresses the attendee', () => {
		expect(attendeeMessage(sampleInput, content)!.to).toBe('jane@example.com');
	});

	test('organizerMessage addresses the configured user', () => {
		expect(organizerMessage(sampleInput, content).to).toBe('owner@acme.test');
	});

	test('attendeeMessage carries an ics when given; otherwise none', () => {
		const ics = { filename: 'x.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' };
		expect(attendeeMessage(sampleInput, content, ics)!.ics).toEqual(ics);
		expect(attendeeMessage(sampleInput, content)!.ics).toBeUndefined();
		expect(organizerMessage(sampleInput, content).ics).toBeUndefined();
	});
});
