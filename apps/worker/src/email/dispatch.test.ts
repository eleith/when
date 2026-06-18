import { describe, expect, test } from 'vitest';
import type { BookingEmailKind } from '@when/jobs';
import { dispatch } from './dispatch.js';
import { sampleInput } from './__fixtures__/booking.js';

const base = {
	appointment: sampleInput.appointment,
	eventType: sampleInput.eventType
};
const run = (kind: BookingEmailKind) => dispatch({ kind, ...base }, sampleInput.cfg);

describe('dispatch', () => {
	test('confirmed → attendee then organizer', async () => {
		const e = await run('confirmed');
		expect(e.map((x) => x.to)).toEqual(['jane@example.com', 'owner@acme.test']);
	});

	test('pending fans out to both the attendee and organizer builders', async () => {
		const e = await run('pending');
		expect(e.map((x) => x.to)).toEqual(['jane@example.com', 'owner@acme.test']);
		expect(e[0].subject).toContain('Booking request received');
		expect(e[1].subject).toContain('Booking request:');
	});

	test('declined → two envelopes, no ics', async () => {
		const e = await run('declined');
		expect(e).toHaveLength(2);
		expect(e.every((x) => x.attachments === undefined)).toBe(true);
	});

	test('cancelled-by-attendee → the attendee gets a CANCEL ics', async () => {
		const [attendee] = await run('cancelled-by-attendee');
		expect(attendee.attachments?.[0].content).toContain('METHOD:CANCEL');
	});

	test('no-email booking yields only the organizer envelope', async () => {
		const noEmail = {
			kind: 'confirmed' as const,
			appointment: { ...sampleInput.appointment, attendee_email: null },
			eventType: sampleInput.eventType
		};
		const e = await dispatch(noEmail, sampleInput.cfg);
		expect(e.map((x) => x.to)).toEqual(['owner@acme.test']);
	});

	test('every kind produces at least one addressed envelope', async () => {
		const kinds: BookingEmailKind[] = [
			'confirmed',
			'pending',
			'cancelled-by-attendee',
			'cancelled-by-organizer',
			'rescheduled-by-attendee',
			'rescheduled-by-organizer',
			'declined'
		];
		for (const kind of kinds) {
			const e = await run(kind);
			expect(e.length).toBeGreaterThan(0);
			expect(e.every((x) => x.to && x.subject && x.html && x.text)).toBe(true);
		}
	});
});
