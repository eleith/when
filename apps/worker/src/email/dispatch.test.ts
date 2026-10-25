import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AppointmentEmailKind } from '@when/jobs';
import { dispatch, prepareAppointmentEmails } from './dispatch.js';
import { sampleInput } from './__fixtures__/appointment.js';
import * as logo from './logo.js';
import type { PreparedAppointmentEmail } from './recipients.js';

afterEach(() => {
	vi.restoreAllMocks();
	logo.clearLogoCache();
});

const base = { appointment: sampleInput.appointment };
const prepare = (kind: AppointmentEmailKind) =>
	prepareAppointmentEmails({ kind, ...base }, sampleInput.cfg);

describe('prepareAppointmentEmails', () => {
	test('pending selects the request-received and host-review messages', async () => {
		const [guest, host] = await prepare('pending');
		expect(guest.envelope.subject).toContain('Appointment request received');
		expect(host.envelope.subject).toContain('Appointment request:');
	});

	test('declined prepares two envelopes without ICS attachments', async () => {
		const prepared = await prepare('declined');
		expect(prepared.map(({ envelope }) => envelope.attachments)).toEqual([undefined, undefined]);
	});

	test('guest cancellation includes a CANCEL invite for the guest', async () => {
		const [guest] = await prepare('cancelled-by-guest');
		expect(guest.envelope.attachments?.[0].content).toContain('METHOD:CANCEL');
	});

	test.each<AppointmentEmailKind>([
		'confirmed',
		'pending',
		'cancelled-by-guest',
		'cancelled-by-host',
		'rescheduled-by-guest',
		'rescheduled-by-host',
		'declined',
		'edited-by-host'
	])('%s preserves builder roles and renders addressed envelopes', async (kind) => {
		const prepared = await prepare(kind);
		expect(prepared.map(({ role, envelope }) => ({ role, to: envelope.to }))).toEqual([
			{ role: 'guest', to: 'jane@example.com' },
			{ role: 'host', to: 'owner@acme.test' }
		]);
		for (const { envelope } of prepared) {
			expect(envelope.subject).toBeTruthy();
			expect(envelope.text).toBeTruthy();
			expect(envelope.html).toBeTruthy();
			expect(envelope).not.toHaveProperty('role');
		}
	});

	test('no guest email prepares only the host', async () => {
		const prepared = await prepareAppointmentEmails(
			{
				kind: 'confirmed',
				appointment: { ...sampleInput.appointment, guest_email: null }
			},
			sampleInput.cfg
		);
		expect(prepared.map(({ role }) => role)).toEqual(['host']);
		expect(prepared[0].envelope.to).toBe('owner@acme.test');
	});

	test('pending edits prepare only the host even with a guest address', async () => {
		const prepared = await prepareAppointmentEmails(
			{
				kind: 'edited-by-host',
				appointment: { ...sampleInput.appointment, status: 'pending' }
			},
			sampleInput.cfg
		);
		expect(prepared.map(({ role }) => role)).toEqual(['host']);
	});

	test('equal addresses prepare two distinct recipient roles', async () => {
		const prepared = await prepareAppointmentEmails(
			{
				kind: 'confirmed',
				appointment: { ...sampleInput.appointment, guest_email: sampleInput.cfg.user.email }
			},
			sampleInput.cfg
		);
		expect(prepared.map(({ role, envelope }) => ({ role, to: envelope.to }))).toEqual([
			{ role: 'guest', to: 'owner@acme.test' },
			{ role: 'host', to: 'owner@acme.test' }
		]);
		expect(prepared[0].envelope.subject).not.toBe(prepared[1].envelope.subject);
	});

	test('prepared envelopes round-trip JSON with string ICS and base64 logo attachments', async () => {
		const bytes = Buffer.from([0, 1, 2, 127, 128, 254, 255]);
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/png' } }));
		const cfg = {
			...sampleInput.cfg,
			user: {
				...sampleInput.cfg.user,
				appearance: { ...sampleInput.cfg.user.appearance, app_icon_path: '/public/logo.png' }
			}
		};
		const prepared = await prepareAppointmentEmails({ kind: 'confirmed', ...base }, cfg);
		const restored: PreparedAppointmentEmail[] = JSON.parse(JSON.stringify(prepared));
		expect(restored).toStrictEqual(prepared);
		expect(fetch).toHaveBeenCalledTimes(1);

		const guest = restored.find(({ role }) => role === 'guest');
		const ics = guest?.envelope.attachments?.find(({ filename }) => filename === 'invite.ics');
		expect(ics?.content).toContain('BEGIN:VCALENDAR');
		expect(ics?.content).toContain('METHOD:REQUEST');
		expect(ics?.contentType).toBe('text/calendar; charset=utf-8');
		expect(ics?.encoding).toBeUndefined();
		for (const { envelope } of restored) {
			const image = envelope.attachments?.find(({ cid }) => cid === logo.BRAND_LOGO_CID);
			expect(image).toEqual({
				filename: 'logo.png',
				content: bytes.toString('base64'),
				contentType: 'image/png',
				cid: logo.BRAND_LOGO_CID,
				encoding: 'base64'
			});
			expect(Buffer.from(image?.content ?? '', 'base64')).toEqual(bytes);
			expect(envelope.html).toContain(`cid:${logo.BRAND_LOGO_CID}`);
		}
	});
});

describe('dispatch', () => {
	test('returns the prepared envelopes and prepares only once per call', async () => {
		const input = { kind: 'pending' as const, ...base };
		const prepared = await prepareAppointmentEmails(input, sampleInput.cfg);
		const fetchLogo = vi.spyOn(logo, 'fetchBrandLogo');
		const envelopes = await dispatch(input, sampleInput.cfg);
		expect(envelopes).toEqual(prepared.map(({ envelope }) => envelope));
		expect(fetchLogo).toHaveBeenCalledTimes(1);
	});
});
