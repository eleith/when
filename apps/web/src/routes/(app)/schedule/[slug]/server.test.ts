import { describe, expect, test, vi, beforeEach } from 'vitest';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { WhenConfiguration } from '@when/config';

const h = vi.hoisted(() => ({
	cfg: { current: null as unknown as WhenConfiguration },
	loadAvailability: vi.fn(),
	computeSlots: vi.fn(),
	createAppointment: vi.fn(),
	parseForm: vi.fn(),
	resolveTimezone: vi.fn(() => 'UTC'),
	resolveDuration: vi.fn()
}));

vi.mock('$lib/server/state', () => ({ getConfig: () => h.cfg.current, getDb: () => ({}) }));
vi.mock('$lib/server/availability/load', () => ({ loadAvailability: h.loadAvailability }));
vi.mock('$lib/server/availability', () => ({ computeSlots: h.computeSlots }));
vi.mock('$lib/server/availability/blocks', () => ({
	loadAppointmentBlocks: async () => ({ appointments: [], perDayCount: {} })
}));
vi.mock('$lib/server/availability/settings', () => ({
	resolveAvailabilitySettings: () => ({ maximum_lookahead: 30 })
}));
vi.mock('@when/db', async (io) => ({
	...(await io<typeof import('@when/db')>()),
	getBusyIntervals: async () => []
}));
vi.mock('$lib/server/appointment/create', () => ({ createAppointment: h.createAppointment }));
vi.mock('$lib/server/appointment/form.server', () => ({
	parseAndValidateAppointmentForm: h.parseForm,
	resolveTimezone: h.resolveTimezone
}));
vi.mock('$lib/server/appointment/duration', () => ({ resolveDuration: h.resolveDuration }));

import { load, actions } from './+page.server';

type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Thrown = { status: number; location?: string };
type Failure = { status?: number };

const SLOT = '2099-05-01T15:00:00Z';

function loadEvent(search: string, session: unknown = null): Parameters<typeof load>[0] {
	return {
		url: new URL(`http://localhost/schedule/30-min${search}`),
		params: { slug: '30-min' },
		locals: { auth: vi.fn().mockResolvedValue(session) }
	} as unknown as Parameters<typeof load>[0];
}

function bookEvent(fd: FormData): Parameters<typeof actions.book>[0] {
	return {
		request: { formData: async () => fd },
		params: { slug: '30-min' },
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

beforeEach(() => {
	vi.clearAllMocks();
	h.cfg.current = validConfig;
	h.resolveTimezone.mockReturnValue('UTC');
	h.loadAvailability.mockResolvedValue({ slotsByDuration: {}, workingWindows: [], busyBlocks: [] });
});

describe('/schedule/[slug] load — deep-link canonicalization', () => {
	test('404s on an unknown slug', async () => {
		const ev = loadEvent('');
		(ev as { params: { slug: string } }).params = { slug: 'does-not-exist' };
		expect((await caught(() => load(ev))).status).toBe(404);
	});

	test('strips unknown params by redirecting to the clean url', async () => {
		const r = await caught(() => load(loadEvent('?foo=bar')));
		expect(r.status).toBe(307);
		expect(r.location).toBe('/schedule/30-min');
	});

	test('strips the default duration (durations[0]) from the query', async () => {
		const r = await caught(() => load(loadEvent('?duration=30')));
		expect(r.status).toBe(307);
		expect(r.location).toBe('/schedule/30-min');
	});

	test('slot wins over date — a request with both redirects to slot only', async () => {
		const r = await caught(() => load(loadEvent(`?slot=${SLOT}&date=2099-05-01`)));
		expect(r.status).toBe(307);
		expect(r.location).toBe(`/schedule/30-min?slot=${encodeURIComponent(SLOT)}`);
	});

	test('keeps a non-default duration but strips junk alongside it', async () => {
		h.cfg.current = {
			...validConfig,
			meetings: [{ ...validConfig.meetings[0], duration_minutes: [30, 60] }]
		};
		const r = await caught(() => load(loadEvent('?duration=60&foo=bar')));
		expect(r.status).toBe(307);
		expect(r.location).toBe('/schedule/30-min?duration=60');
	});

	test('returns page data unchanged when the query is already canonical', async () => {
		const result = (await load(loadEvent(`?slot=${SLOT}`))) as LoadResult;
		expect(result.eventType.name).toBe('30-min-chat');
		expect(result.isAdmin).toBe(false);
		expect(h.loadAvailability).toHaveBeenCalledOnce();
	});
});

describe('/schedule/[slug] book action', () => {
	function validForm(): FormData {
		const fd = new FormData();
		fd.set('slot', SLOT);
		return fd;
	}
	const validGuest = {
		ok: true,
		data: { name: 'A', email: 'a@b.co', answers: null, location: null }
	};

	test('rejects a missing slot with 400', async () => {
		const result = (await actions.book(bookEvent(new FormData()))) as Failure;
		expect(result?.status).toBe(400);
	});

	test('rejects invalid form fields with 400', async () => {
		h.parseForm.mockReturnValue({ ok: false, errors: { name: 'required' } });
		expect(((await actions.book(bookEvent(validForm()))) as Failure)?.status).toBe(400);
	});

	test('rejects an invalid duration with 400', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(null);
		expect(((await actions.book(bookEvent(validForm()))) as Failure)?.status).toBe(400);
	});

	test('re-validates availability and 409s when the slot is gone', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(30);
		h.computeSlots.mockReturnValue([]);
		const result = (await actions.book(bookEvent(validForm()))) as Failure;
		expect(result?.status).toBe(409);
		expect(h.createAppointment).not.toHaveBeenCalled();
	});

	test('books and redirects to the new appointment on success', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(30);
		h.computeSlots.mockReturnValue([Temporal.Instant.from(SLOT)]);
		h.createAppointment.mockResolvedValue({
			ok: true,
			appointment: { id: 'new-1', cancel_token: 'tok new' }
		});
		const r = await caught(() => actions.book(bookEvent(validForm())));
		expect(r.status).toBe(303);
		expect(r.location).toBe('/appointment/new-1?token=tok%20new');
	});

	test('409s when the row insert loses the race (created not ok)', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(30);
		h.computeSlots.mockReturnValue([Temporal.Instant.from(SLOT)]);
		h.createAppointment.mockResolvedValue({ ok: false });
		expect(((await actions.book(bookEvent(validForm()))) as Failure)?.status).toBe(409);
	});

	test('500s when the insert throws', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(30);
		h.computeSlots.mockReturnValue([Temporal.Instant.from(SLOT)]);
		h.createAppointment.mockRejectedValue(new Error('db down'));
		expect(((await actions.book(bookEvent(validForm()))) as Failure)?.status).toBe(500);
	});
});
