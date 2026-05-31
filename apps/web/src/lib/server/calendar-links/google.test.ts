import { describe, expect, test } from 'vitest';
import { buildLink } from './google';

const baseInput = {
	start: '2026-04-27T13:00:00Z',
	end: '2026-04-27T13:30:00Z',
	title: 'Chat with Jane'
};

describe('google calendar link', () => {
	test('points at calendar.google.com with TEMPLATE action', () => {
		const url = new URL(buildLink(baseInput));
		expect(url.host).toBe('calendar.google.com');
		expect(url.pathname).toBe('/calendar/render');
		expect(url.searchParams.get('action')).toBe('TEMPLATE');
	});

	test('encodes dates as YYYYMMDDTHHMMSSZ separated by /', () => {
		const url = new URL(buildLink(baseInput));
		expect(url.searchParams.get('dates')).toBe('20260427T130000Z/20260427T133000Z');
	});

	test('strips fractional seconds from dates', () => {
		const url = new URL(
			buildLink({
				...baseInput,
				start: '2026-04-27T13:00:00.123Z',
				end: '2026-04-27T13:30:00.999Z'
			})
		);
		expect(url.searchParams.get('dates')).toBe('20260427T130000Z/20260427T133000Z');
	});

	test('passes title through `text` param', () => {
		const url = new URL(buildLink(baseInput));
		expect(url.searchParams.get('text')).toBe('Chat with Jane');
	});

	test('encodes special chars in title', () => {
		const url = new URL(buildLink({ ...baseInput, title: 'Q&A: planning + recap (30 min)' }));
		expect(url.searchParams.get('text')).toBe('Q&A: planning + recap (30 min)');
	});

	test('omits details and location when not provided', () => {
		const url = new URL(buildLink(baseInput));
		expect(url.searchParams.has('details')).toBe(false);
		expect(url.searchParams.has('location')).toBe(false);
	});

	test('includes details and location when provided', () => {
		const url = new URL(
			buildLink({
				...baseInput,
				description: 'Looking forward to chatting',
				location: 'Coffee shop on Main St'
			})
		);
		expect(url.searchParams.get('details')).toBe('Looking forward to chatting');
		expect(url.searchParams.get('location')).toBe('Coffee shop on Main St');
	});
});
