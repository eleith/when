import { describe, expect, test } from 'bun:test';
import { buildAddToCalendarLinks } from '../../src/lib/server/calendar-links';

const input = {
	start: '2026-04-27T13:00:00Z',
	end: '2026-04-27T13:30:00Z',
	title: 'Chat with Jane'
};

describe('buildAddToCalendarLinks', () => {
	test('returns google, outlook, and ics fields', () => {
		const links = buildAddToCalendarLinks(input, 'https://when.example.com/booked/x.ics');
		expect(new URL(links.google).host).toBe('calendar.google.com');
		expect(new URL(links.outlook).host).toBe('outlook.live.com');
		expect(links.ics).toBe('https://when.example.com/booked/x.ics');
	});
});
