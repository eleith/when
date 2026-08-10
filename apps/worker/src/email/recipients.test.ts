import { describe, expect, test } from 'vitest';
import { guestMessage, hostMessage } from './recipients.js';
import { sampleInput } from './__fixtures__/appointment.js';
import type { EmailContent } from './content.js';

const content: EmailContent = {
	brand: {
		name: 'Acme',
		pageTitle: 'Acme',
		appUrl: 'https://when.example.com',
		primaryColor: '#2563eb',
		onPrimary: '#ffffff'
	},
	subject: 'S',
	heading: 'H',
	paragraphs: [],
	rows: [],
	actions: []
};

describe('recipients', () => {
	test('guestMessage addresses the guest', () => {
		expect(guestMessage(sampleInput, content)!.to).toBe('jane@example.com');
	});

	test('hostMessage addresses the configured user', () => {
		expect(hostMessage(sampleInput, content).to).toBe('owner@acme.test');
	});

	test('guestMessage carries an ics when given; otherwise none', () => {
		const ics = { filename: 'x.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' };
		expect(guestMessage(sampleInput, content, ics)!.ics).toEqual(ics);
		expect(guestMessage(sampleInput, content)!.ics).toBeUndefined();
		expect(hostMessage(sampleInput, content).ics).toBeUndefined();
	});
});
