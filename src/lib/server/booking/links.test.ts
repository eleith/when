import { expect, test } from 'vitest';
import { bookingLinks } from './links';

const base = {
	baseUrl: 'https://when.example.com',
	appointment: { id: 'a1', cancel_token: 'tok n' }
};

test('builds the booking action URLs with an encoded token', () => {
	const l = bookingLinks({ ...base, eventType: { slug: '30-min' } });
	expect(l.booked).toBe('https://when.example.com/booked/a1?token=tok%20n');
	expect(l.cancel).toBe('https://when.example.com/booked/a1?token=tok%20n&cancel=1');
	expect(l.reschedule).toBe('https://when.example.com/schedule/30-min?reschedule=a1&token=tok%20n');
	expect(l.manage).toBe('https://when.example.com/signin?callbackUrl=%2Fbooked%2Fa1');
});

test('reschedule falls back to the booking page when the event type is gone', () => {
	const l = bookingLinks(base);
	expect(l.reschedule).toBe(l.booked);
});
