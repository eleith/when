import { describe, expect, test, vi, beforeEach } from 'vitest';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { Appointment } from '@when/db';

const h = vi.hoisted(() => ({
	row: { current: null as Appointment | null },
	viewAllowed: vi.fn(),
	classify: vi.fn(),
	reschedule: vi.fn(),
	loadAvailability: vi.fn(),
	isSlotBookable: vi.fn(),
	parseForm: vi.fn(),
	resolveTimezone: vi.fn(() => 'UTC'),
	validateReason: vi.fn(),
	resolveDuration: vi.fn()
}));

vi.mock('$lib/server/state', () => ({ getConfig: () => validConfig, getDb: () => ({}) }));
vi.mock('@when/db', async (io) => ({
	...(await io<typeof import('@when/db')>()),
	findAppointment: async () => h.row.current
}));
vi.mock('$lib/server/appointment/access', () => ({
	isViewAllowed: h.viewAllowed
}));
vi.mock('$lib/server/appointment/reschedule', () => ({
	classifyReschedule: h.classify,
	rescheduleAppointment: h.reschedule
}));
vi.mock('$lib/server/availability/load', () => ({
	loadAvailability: h.loadAvailability,
	isSlotBookable: h.isSlotBookable
}));
vi.mock('$lib/server/appointment/form.server', async (io) => ({
	...(await io<typeof import('$lib/server/appointment/form.server')>()),
	parseAndValidateAppointmentForm: h.parseForm,
	resolveTimezone: h.resolveTimezone,
	validateReason: h.validateReason
}));
vi.mock('$lib/server/appointment/duration', () => ({ resolveDuration: h.resolveDuration }));
vi.mock('$lib/server/appointment/sanitize', () => ({
	toPublicAppointment: (row: Appointment) => ({ id: row.id }),
	toPublicEventType: (et: { name: string }) => ({ name: et.name })
}));
vi.mock('@when/config', async (io) => ({
	...(await io<typeof import('@when/config')>()),
	resolveFormFields: () => []
}));

import { load, actions } from './+page.server';

type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Thrown = { status: number; location?: string };
type Failure = { status?: number };

const CURRENT = '2099-05-01T15:00:00Z';
const NEW_SLOT = '2099-05-02T16:00:00Z';

function appt(): Appointment {
	return {
		id: 'appt-1',
		event_type_id: '30-min-chat',
		start_time: CURRENT,
		cancel_token: 'tok-1',
		status: 'confirmed'
	} as unknown as Appointment;
}

function loadEvent(token = 'tok-1', session: unknown = null): Parameters<typeof load>[0] {
	return {
		url: new URL(`http://localhost/appointment/appt-1/reschedule?token=${token}`),
		params: { id: 'appt-1' },
		locals: { auth: vi.fn().mockResolvedValue(session) }
	} as unknown as Parameters<typeof load>[0];
}

function bookEvent(fd: FormData): Parameters<typeof actions.book>[0] {
	return {
		request: { formData: async () => fd },
		params: { id: 'appt-1' },
		cookies: { set: vi.fn() }
	} as unknown as Parameters<typeof actions.book>[0];
}

async function caught(fn: () => unknown): Promise<Thrown> {
	try {
		await fn();
	} catch (e) {
		return e as Thrown;
	}
	throw new Error('expected a thrown redirect/error');
}

function form(overrides: Record<string, string> = {}): FormData {
	const fd = new FormData();
	fd.set('slot', NEW_SLOT);
	fd.set('token', 'tok-1');
	for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
	return fd;
}

async function book(fd: FormData): Promise<Failure> {
	return (await actions.book(bookEvent(fd))) as Failure;
}

beforeEach(() => {
	vi.clearAllMocks();
	h.row.current = appt();
	h.viewAllowed.mockResolvedValue(true);
	h.classify.mockReturnValue({ kind: 'ok' });
	h.loadAvailability.mockResolvedValue({ slotsByDuration: {}, workingWindows: [], busyBlocks: [] });
	h.isSlotBookable.mockResolvedValue(true);
	h.resolveTimezone.mockReturnValue('UTC');
	h.validateReason.mockReturnValue({ ok: true, reason: null });
	h.resolveDuration.mockReturnValue(30);
});

describe('/appointment/[id]/reschedule load', () => {
	test('returns the appointment and loads availability around its current slot', async () => {
		const result = (await load(loadEvent())) as LoadResult;
		expect(result.reschedule.appt).toEqual({ id: 'appt-1' });
		expect(result.reschedule.error).toBeNull();
		expect(h.loadAvailability).toHaveBeenCalledWith(expect.anything(), expect.anything(), CURRENT);
	});

	test('surfaces a classify error and nulls the appointment', async () => {
		h.classify.mockReturnValue({ kind: 'error', code: 'too_late' });
		const result = (await load(loadEvent())) as LoadResult;
		expect(result.reschedule.error).toBe('too_late');
		expect(result.reschedule.appt).toBeNull();
	});
});

describe('/appointment/[id]/reschedule book action', () => {
	test('400 on a missing slot', async () => {
		expect((await book(form({ slot: '' })))?.status).toBe(400);
	});

	test('403 when the token does not match the appointment', async () => {
		expect((await book(form({ token: 'wrong' })))?.status).toBe(403);
	});

	test('400 when the chosen slot equals the current slot', async () => {
		expect((await book(form({ slot: CURRENT })))?.status).toBe(400);
	});

	test('400 on invalid form fields', async () => {
		h.parseForm.mockReturnValue({ ok: false, errors: { name: 'x' } });
		expect((await book(form()))?.status).toBe(400);
	});

	test('400 on an invalid reason', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.validateReason.mockReturnValue({ ok: false, error: 'too long' });
		expect((await book(form()))?.status).toBe(400);
	});

	test('re-validates excluding the current slot, 409 when not bookable', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.isSlotBookable.mockResolvedValue(false);
		expect((await book(form()))?.status).toBe(409);
		expect(h.isSlotBookable).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			NEW_SLOT,
			30,
			CURRENT
		);
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test('reschedules and redirects to the new row on success', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.reschedule.mockResolvedValue({
			ok: true,
			appointment: { id: 'appt-2', cancel_token: 'tok-2' }
		});
		const r = await caught(() => actions.book(bookEvent(form())));
		expect(r.status).toBe(303);
		expect(r.location).toBe('/appointment/appt-2?token=tok-2');
	});

	test('409 when the reschedule loses the slot race', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.reschedule.mockResolvedValue({ ok: false, reason: 'slot_taken' });
		expect((await book(form()))?.status).toBe(409);
	});

	test('409 when the appointment can no longer be rescheduled', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.reschedule.mockResolvedValue({ ok: false, reason: 'gated' });
		expect((await book(form()))?.status).toBe(409);
	});
});
