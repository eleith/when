import { describe, expect, test } from 'vitest';
import { buildLink } from '$lib/server/calendar-links/outlook';

const baseInput = {
	start: '2026-04-27T13:00:00Z',
	end: '2026-04-27T13:30:00Z',
	title: 'Chat with Jane'
};

describe('outlook calendar link', () => {
	test('points at outlook.live.com with addevent rru', () => {
		const url = new URL(buildLink(baseInput));
		expect(url.host).toBe('outlook.live.com');
		expect(url.pathname).toBe('/calendar/0/deeplink/compose');
		expect(url.searchParams.get('rru')).toBe('addevent');
		expect(url.searchParams.get('path')).toBe('/calendar/action/compose');
	});

	test('passes ISO dates verbatim through startdt/enddt', () => {
		const url = new URL(buildLink(baseInput));
		expect(url.searchParams.get('startdt')).toBe('2026-04-27T13:00:00Z');
		expect(url.searchParams.get('enddt')).toBe('2026-04-27T13:30:00Z');
	});

	test('passes title through `subject` param', () => {
		const url = new URL(buildLink(baseInput));
		expect(url.searchParams.get('subject')).toBe('Chat with Jane');
	});

	test('omits body and location when not provided', () => {
		const url = new URL(buildLink(baseInput));
		expect(url.searchParams.has('body')).toBe(false);
		expect(url.searchParams.has('location')).toBe(false);
	});

	test('includes body and location when provided', () => {
		const url = new URL(
			buildLink({
				...baseInput,
				description: 'Looking forward to chatting',
				location: 'Coffee shop on Main St'
			})
		);
		expect(url.searchParams.get('body')).toBe('Looking forward to chatting');
		expect(url.searchParams.get('location')).toBe('Coffee shop on Main St');
	});
});
