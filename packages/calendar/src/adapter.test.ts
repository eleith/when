import { describe, expect, test } from 'vitest';
import type { ResolvedCalendar } from '@when/config';
import { getCalendarAdapter } from './adapter.js';

const googleCal = (refresh_token: string): ResolvedCalendar => ({
	type: 'google',
	name: 'personal',
	providerName: 'gg',
	provider: {
		type: 'google',
		client_id: 'cid',
		client_secret: 'csec',
		refresh_token,
		calendars: {}
	},
	calendar: { id: 'primary', sync: { refresh_every_minutes: 10 } }
});

const davCal: ResolvedCalendar = {
	type: 'caldav',
	name: 'work',
	providerName: 'dav',
	provider: {
		type: 'caldav',
		url: 'https://d.example/',
		username: 'u',
		password: 'p',
		calendars: {}
	},
	calendar: { href: 'calendars/u/work/', sync: { refresh_every_minutes: 10 } }
};

const window = {
	start: Temporal.Instant.from('2026-04-01T00:00:00Z'),
	end: Temporal.Instant.from('2026-05-01T00:00:00Z')
};

describe('getCalendarAdapter', () => {
	test('builds each adapter from the provider its calendar already carries', () => {
		expect(getCalendarAdapter(googleCal('rt-1'))).toBeDefined();
		expect(getCalendarAdapter(davCal)).toBeDefined();
	});

	// The refresh token reaches the adapter from when.yaml, so an empty one is the
	// unconnected state and must fail before any request goes out.
	test('refuses a google calendar whose provider has no refresh token', async () => {
		const adapter = getCalendarAdapter(googleCal(''));
		await expect(adapter.fetchBusy(window)).rejects.toThrow('not connected');
	});
});
