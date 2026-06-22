import { describe, expect, test } from 'vitest';
import type { AppointmentEmailKind } from '@when/jobs';
import { dispatch } from './dispatch.js';
import { sampleInput } from './__fixtures__/appointment.js';

const base = {
	appointment: sampleInput.appointment,
	eventType: sampleInput.eventType
};
const run = (kind: AppointmentEmailKind) => dispatch({ kind, ...base }, sampleInput.cfg);

describe('dispatch', () => {
	test('confirmed → guest then host', async () => {
		const e = await run('confirmed');
		expect(e.map((x) => x.to)).toEqual(['jane@example.com', 'owner@acme.test']);
	});

	test('pending fans out to both the guest and host builders', async () => {
		const e = await run('pending');
		expect(e.map((x) => x.to)).toEqual(['jane@example.com', 'owner@acme.test']);
		expect(e[0].subject).toContain('Appointment request received');
		expect(e[1].subject).toContain('Appointment request:');
	});

	test('declined → two envelopes, no ics', async () => {
		const e = await run('declined');
		expect(e).toHaveLength(2);
		expect(e.every((x) => x.attachments === undefined)).toBe(true);
	});

	test('cancelled-by-guest → the guest gets a CANCEL ics', async () => {
		const [guest] = await run('cancelled-by-guest');
		expect(guest.attachments?.[0].content).toContain('METHOD:CANCEL');
	});

	test('no-email appointment yields only the host envelope', async () => {
		const noEmail = {
			kind: 'confirmed' as const,
			appointment: { ...sampleInput.appointment, guest_email: null },
			eventType: sampleInput.eventType
		};
		const e = await dispatch(noEmail, sampleInput.cfg);
		expect(e.map((x) => x.to)).toEqual(['owner@acme.test']);
	});

	test('every kind produces at least one addressed envelope', async () => {
		const kinds: AppointmentEmailKind[] = [
			'confirmed',
			'pending',
			'cancelled-by-guest',
			'cancelled-by-host',
			'rescheduled-by-guest',
			'rescheduled-by-host',
			'declined'
		];
		for (const kind of kinds) {
			const e = await run(kind);
			expect(e.length).toBeGreaterThan(0);
			expect(e.every((x) => x.to && x.subject && x.html && x.text)).toBe(true);
		}
	});
});
