import { describe, expect, test, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { Appointment } from '@when/db';

const h = vi.hoisted(() => ({
	row: { current: null as Appointment | null },
	requireViewable: vi.fn(),
	buildIcs: vi.fn(() => 'BEGIN:VCALENDAR')
}));

vi.mock('$lib/server/state', () => ({ getConfig: () => validConfig, getDb: () => ({}) }));
vi.mock('@when/db', async (io) => ({
	...(await io<typeof import('@when/db')>()),
	findAppointment: async () => h.row.current
}));
vi.mock('$lib/server/appointment/access', () => ({ requireViewableAppointment: h.requireViewable }));
vi.mock('@when/calendar', async (io) => ({
	...(await io<typeof import('@when/calendar')>()),
	buildIcs: h.buildIcs
}));
vi.mock('@when/config', async (io) => ({
	...(await io<typeof import('@when/config')>()),
	senderEmail: () => 'host@example.com'
}));

import { GET } from './+server';

type Thrown = { status: number };

function event(token: string | null): Parameters<typeof GET>[0] {
	const q = token === null ? '' : `?token=${token}`;
	return {
		params: { id: 'appt-1' },
		url: new URL(`http://localhost/appointment/appt-1/ics${q}`)
	} as unknown as Parameters<typeof GET>[0];
}

async function caught(fn: () => unknown): Promise<Thrown> {
	try {
		await fn();
	} catch (e) {
		return e as Thrown;
	}
	throw new Error('expected a thrown error');
}

function appt(status = 'confirmed'): Appointment {
	return { id: 'appt-1', event_type_id: '30-min-chat', status } as unknown as Appointment;
}

beforeEach(() => {
	vi.clearAllMocks();
	h.row.current = appt();
	h.requireViewable.mockReturnValue(h.row.current);
	h.buildIcs.mockReturnValue('BEGIN:VCALENDAR');
});

describe('GET /appointment/[id]/ics', () => {
	test('404s when no token is supplied', async () => {
		expect((await caught(() => GET(event(null)))).status).toBe(404);
	});

	test('serves the ics for a confirmed, viewable appointment', async () => {
		const res = await GET(event('tok-1'));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
		expect(res.headers.get('content-disposition')).toBe('attachment; filename="appt-1.ics"');
		expect(await res.text()).toBe('BEGIN:VCALENDAR');
	});

	test('403s when the appointment is not confirmed', async () => {
		h.row.current = appt('pending');
		h.requireViewable.mockReturnValue(h.row.current);
		expect((await caught(() => GET(event('tok-1')))).status).toBe(403);
		expect(h.buildIcs).not.toHaveBeenCalled();
	});

	test('404s when the meeting type no longer exists', async () => {
		h.row.current = appt();
		h.row.current.event_type_id = 'gone';
		h.requireViewable.mockReturnValue(h.row.current);
		expect((await caught(() => GET(event('tok-1')))).status).toBe(404);
	});

	test('propagates the access error for a bad or expired token', async () => {
		h.requireViewable.mockImplementation(() => {
			throw error(403, 'nope');
		});
		expect((await caught(() => GET(event('tok-1')))).status).toBe(403);
	});
});
