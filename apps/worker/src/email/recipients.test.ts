import { describe, expect, test } from 'vitest';
import { guestMessage, hostMessage, messages } from './recipients.js';
import { sampleInput } from './__fixtures__/appointment.js';
import type { EmailContent } from './content.js';

const content: EmailContent = {
	brand: {
		name: 'Acme',
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
	test('guestMessage assigns the guest role and address', () => {
		expect(guestMessage(sampleInput, content)).toEqual({
			role: 'guest',
			to: 'jane@example.com',
			content,
			ics: undefined
		});
	});

	test('hostMessage assigns the host role and configured address', () => {
		expect(hostMessage(sampleInput, content)).toEqual({
			role: 'host',
			to: 'owner@acme.test',
			content
		});
	});

	test('missing guest email produces null and is dropped without changing the host role', () => {
		const input = {
			...sampleInput,
			appointment: { ...sampleInput.appointment, guest_email: null }
		};
		const guest = guestMessage(input, content);
		const host = hostMessage(input, content);
		expect(guest).toBeNull();
		expect(messages(guest, host)).toEqual([host]);
		expect(messages(null)).toEqual([]);
	});

	test('equal addresses keep distinct roles regardless of collection order', () => {
		const input = {
			...sampleInput,
			appointment: { ...sampleInput.appointment, guest_email: sampleInput.cfg.user.email }
		};
		const host = hostMessage(input, content);
		const guest = guestMessage(input, content);
		expect(messages(host, guest).map(({ role, to }) => ({ role, to }))).toEqual([
			{ role: 'host', to: 'owner@acme.test' },
			{ role: 'guest', to: 'owner@acme.test' }
		]);
	});

	test('guestMessage carries an ics when given; otherwise none', () => {
		const ics = { filename: 'x.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' };
		expect(guestMessage(sampleInput, content, ics)!.ics).toEqual(ics);
		expect(guestMessage(sampleInput, content)!.ics).toBeUndefined();
		expect(hostMessage(sampleInput, content).ics).toBeUndefined();
	});
});
