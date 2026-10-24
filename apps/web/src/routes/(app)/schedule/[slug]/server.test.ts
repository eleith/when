import { describe, expect, test, vi, beforeEach } from 'vitest';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { Meeting, WhenConfiguration } from '@when/config';
import type { AppointmentRole } from '$lib/server/appointment/actions';
import { resolveBookingDurations } from '$lib/server/appointment/duration';
import { toPublicEventType } from '$lib/server/appointment/sanitize';

const h = vi.hoisted(() => ({
	cfg: { current: null as unknown as WhenConfiguration },
	loadAvailability: vi.fn(),
	db: {},
	getDb: vi.fn(),
	isNewSlotBookable: vi.fn(),
	createAppointment: vi.fn(),
	parseForm: vi.fn(),
	resolveTimezone: vi.fn(() => 'UTC'),
	resolveDuration: vi.fn()
}));

vi.mock('$lib/server/state', () => ({ getConfig: () => h.cfg.current, getDb: h.getDb }));
vi.mock('$lib/server/availability/booking', () => ({
	loadAvailability: h.loadAvailability,
	isNewSlotBookable: h.isNewSlotBookable
}));
vi.mock('$lib/server/appointment/create', () => ({ createAppointment: h.createAppointment }));
vi.mock('$lib/server/appointment/form.server', async (io) => {
	const original = await io<typeof import('$lib/server/appointment/form.server')>();
	return {
		...original,
		parseAndValidateAppointmentForm: h.parseForm,
		resolveTimezone: h.resolveTimezone
	};
});
vi.mock('$lib/server/appointment/duration', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/server/appointment/duration')>();
	return { ...original, resolveDuration: h.resolveDuration };
});
vi.mock('$lib/server/appointment/sanitize', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/server/appointment/sanitize')>();
	return { ...original, toPublicEventType: vi.fn(original.toPublicEventType) };
});

import { load, actions } from './+page.server';

type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Thrown = { status: number; location?: string };
type Failure = { status?: number };

const SLOT = '2099-05-01T15:00:00Z';

function loadEvent(search: string, session: unknown = null): Parameters<typeof load>[0] {
	return {
		url: new URL(`http://localhost/schedule/30-min-chat${search}`),
		params: { slug: '30-min-chat' },
		locals: { auth: vi.fn().mockResolvedValue(session) }
	} as unknown as Parameters<typeof load>[0];
}

function bookEvent(fd: FormData, session: unknown = null): Parameters<typeof actions.default>[0] {
	return {
		request: { formData: async () => fd },
		params: { slug: '30-min-chat' },
		locals: { auth: vi.fn().mockResolvedValue(session) },
		cookies: { set: vi.fn() }
	} as unknown as Parameters<typeof actions.default>[0];
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
	h.getDb.mockReturnValue(h.db);
	h.loadAvailability.mockImplementation(
		async (_db, _cfg, _slug, meeting: Meeting, role: AppointmentRole) => {
			const bookingDurations = resolveBookingDurations(meeting, role);
			return {
				bookingDurations,
				slotsByDuration: Object.fromEntries(
					bookingDurations.durations.map((duration) => [duration, {}])
				),
				workingWindows: [],
				busyBlocks: []
			};
		}
	);
});

describe('/schedule/[slug] load — deep-link canonicalization', () => {
	test('404s on an unknown slug', async () => {
		const ev = loadEvent('');
		(ev as { params: { slug: string } }).params = { slug: 'does-not-exist' };
		const result = await caught(() => load(ev));
		expect(result.status).toBe(404);
	});

	test('strips unknown params by redirecting to the clean url', async () => {
		const r = await caught(() => load(loadEvent('?foo=bar')));
		expect(r.status).toBe(307);
		expect(r.location).toBe('/schedule/30-min-chat');
		expect(h.getDb).not.toHaveBeenCalled();
		expect(h.loadAvailability).not.toHaveBeenCalled();
	});

	test('strips the configured default duration from the query', async () => {
		const r = await caught(() => load(loadEvent('?duration=30')));
		expect(r.status).toBe(307);
		expect(r.location).toBe('/schedule/30-min-chat');
	});

	test('slot wins over date — a request with both redirects to slot only', async () => {
		const r = await caught(() => load(loadEvent(`?slot=${SLOT}&date=2099-05-01`)));
		expect(r.status).toBe(307);
		expect(r.location).toBe(`/schedule/30-min-chat?slot=${encodeURIComponent(SLOT)}`);
	});

	test('keeps a non-default duration but strips junk alongside it', async () => {
		h.cfg.current = {
			...validConfig,
			meetings: {
				'30-min-chat': {
					...validConfig.meetings['30-min-chat'],
					duration_minutes: 30,
					additional_duration_minutes: [60]
				}
			}
		};
		const r = await caught(() => load(loadEvent('?duration=60&foo=bar')));
		expect(r.status).toBe(307);
		expect(r.location).toBe('/schedule/30-min-chat?duration=60');
	});

	test('canonicalizes the configured default of 60 before reading availability, not the host palette minimum', async () => {
		h.cfg.current = structuredClone(validConfig);
		h.cfg.current.meetings['30-min-chat'].duration_minutes = 60;
		const session = { user: { name: 'Host' } };
		const redirect = await caught(() => load(loadEvent('?duration=60', session)));
		expect(redirect).toMatchObject({ status: 307, location: '/schedule/30-min-chat' });
		expect(h.getDb).not.toHaveBeenCalled();
		expect(h.loadAvailability).not.toHaveBeenCalled();
		const loaded = await load(loadEvent('?duration=15', session));
		const result = loaded as LoadResult;
		expect(result.eventType.duration_minutes).toBe(60);
		expect(result.eventType.durations[0]).toBe(15);
	});

	test('keeps a host-only duration=90 for hosts but strips it for guests before availability', async () => {
		const redirect = await caught(() => load(loadEvent('?duration=90')));
		expect(redirect).toMatchObject({ status: 307, location: '/schedule/30-min-chat' });
		expect(h.getDb).not.toHaveBeenCalled();
		expect(h.loadAvailability).not.toHaveBeenCalled();
		const loaded = await load(loadEvent('?duration=90', { user: { name: 'Host' } }));
		const result = loaded as LoadResult;
		expect(result.eventType.durations).toContain(90);
	});

	test.for([
		{ role: 'guest', session: null, formAction: '/schedule/30-min-chat' },
		{ role: 'host', session: { user: { name: 'Host' } }, formAction: '/admin/schedule/30-min-chat' }
	])(
		'returns canonical page data and loads $role availability',
		async ({ role, session, formAction }) => {
			h.cfg.current = structuredClone(validConfig);
			Object.assign(h.cfg.current.meetings['30-min-chat'], {
				location: 'Private host location',
				padding_before_minutes: 15,
				padding_after_minutes: 10
			});
			const loaded = await load(loadEvent(`?slot=${SLOT}`, session));
			const result = loaded as LoadResult;
			const availability = await h.loadAvailability.mock.results[0].value;
			expect(toPublicEventType).toHaveBeenCalledExactlyOnceWith(
				'30-min-chat',
				h.cfg.current.meetings['30-min-chat'],
				role,
				availability.bookingDurations
			);
			expect(vi.mocked(toPublicEventType).mock.calls[0][3]).toBe(availability.bookingDurations);
			expect(result.eventType.duration_minutes).toBe(availability.bookingDurations.defaultDuration);
			expect(result.eventType.durations).toBe(availability.bookingDurations.durations);
			expect(result.availability.slotsByDuration).toBe(availability.slotsByDuration);
			expect(Object.keys(result.availability.slotsByDuration).map(Number)).toEqual(
				[...result.eventType.durations].sort((a, b) => a - b)
			);
			expect(result.eventType.slug).toBe('30-min-chat');
			expect(result.eventType.location).toBe(role === 'host' ? 'Private host location' : undefined);
			expect(result.eventType.padding_before_minutes).toBe(role === 'host' ? 0 : 15);
			expect(result.eventType.padding_after_minutes).toBe(role === 'host' ? 0 : 10);
			expect(result.role).toBe(role);
			expect(result.formAction).toBe(formAction);
			expect(result.guestFieldsDisabled).toBe(false);
			expect(result).not.toHaveProperty('viewer');
			expect(result).not.toHaveProperty('isAdmin');
			expect(result).not.toHaveProperty('isHost');
			expect(h.loadAvailability).toHaveBeenCalledExactlyOnceWith(
				h.db,
				h.cfg.current,
				'30-min-chat',
				h.cfg.current.meetings['30-min-chat'],
				role
			);
		}
	);
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

	test('404s on an unknown meeting before checking availability', async () => {
		const event = bookEvent(validForm());
		event.params.slug = 'missing';
		const result = await caught(() => actions.default(event));
		expect(result.status).toBe(404);
		expect(h.isNewSlotBookable).not.toHaveBeenCalled();
		expect(h.createAppointment).not.toHaveBeenCalled();
	});

	test('rejects a missing slot with 400', async () => {
		const response = await actions.default(bookEvent(new FormData()));
		const result = response as Failure;
		expect(result?.status).toBe(400);
	});

	test.for(['not-a-time', '2099-13-45T99:99:99Z', '2099-05-01'])(
		'rejects the unparseable slot %s with 400',
		async (slot) => {
			h.parseForm.mockReturnValue(validGuest);
			const fd = new FormData();
			fd.set('slot', slot);
			const response = await actions.default(bookEvent(fd));
			expect((response as Failure)?.status).toBe(400);
		}
	);

	test('rejects invalid form fields with 400', async () => {
		h.parseForm.mockReturnValue({ ok: false, errors: { name: 'required' } });
		const response = await actions.default(bookEvent(validForm()));
		expect((response as Failure)?.status).toBe(400);
	});

	test('rejects an invalid duration with 400', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(null);
		const response = await actions.default(bookEvent(validForm()));
		expect((response as Failure)?.status).toBe(400);
		expect(h.isNewSlotBookable).not.toHaveBeenCalled();
		expect(h.createAppointment).not.toHaveBeenCalled();
	});

	test('re-validates availability and 409s when the slot is gone', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(30);
		h.isNewSlotBookable.mockResolvedValue(false);
		const response = await actions.default(bookEvent(validForm()));
		const result = response as Failure;
		expect(result?.status).toBe(409);
		expect(h.isNewSlotBookable).toHaveBeenCalledExactlyOnceWith(
			h.db,
			h.cfg.current,
			'30-min-chat',
			h.cfg.current.meetings['30-min-chat'],
			'guest',
			SLOT,
			30
		);
		expect(h.createAppointment).not.toHaveBeenCalled();
	});

	test('ignores forged host flags and checks guest availability', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(30);
		h.isNewSlotBookable.mockResolvedValue(false);
		const fd = validForm();
		fd.set('viewer', 'host');
		fd.set('role', 'host');
		fd.set('isAdmin', 'true');
		fd.set('currentDuration', '90');
		const response = await actions.default(bookEvent(fd));
		expect(h.resolveDuration).toHaveBeenCalledExactlyOnceWith(
			h.cfg.current.meetings['30-min-chat'],
			'guest',
			fd
		);
		expect((response as Failure)?.status).toBe(409);
		expect(h.isNewSlotBookable).toHaveBeenCalledExactlyOnceWith(
			h.db,
			h.cfg.current,
			'30-min-chat',
			h.cfg.current.meetings['30-min-chat'],
			'guest',
			SLOT,
			30
		);
		expect(h.createAppointment).not.toHaveBeenCalled();
	});

	test.for([false, true])('books as guest even with forged host fields: %s', async (forged) => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(60);
		h.isNewSlotBookable.mockResolvedValue(true);
		h.createAppointment.mockResolvedValue({
			ok: true,
			appointment: { id: 'new-1', cancel_token: 'tok new' }
		});
		const fd = validForm();
		if (forged) {
			fd.set('viewer', 'host');
			fd.set('role', 'host');
			fd.set('isAdmin', 'true');
			fd.set('currentDuration', '90');
		}
		const session = forged ? { user: { name: 'Host' } } : null;
		const event = bookEvent(fd, session);
		const r = await caught(() => actions.default(event));
		expect(r.status).toBe(303);
		expect(r.location).toBe('/appointment/new-1?token=tok%20new');
		expect(h.resolveDuration).toHaveBeenCalledExactlyOnceWith(
			h.cfg.current.meetings['30-min-chat'],
			'guest',
			fd
		);
		expect(event.cookies.set).toHaveBeenCalledWith('submitted', 'request', {
			path: '/',
			maxAge: 10,
			httpOnly: true,
			sameSite: 'lax'
		});
		expect(h.isNewSlotBookable).toHaveBeenCalledExactlyOnceWith(
			h.db,
			h.cfg.current,
			'30-min-chat',
			h.cfg.current.meetings['30-min-chat'],
			'guest',
			SLOT,
			60
		);
		expect(h.createAppointment).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				start: SLOT,
				end: '2099-05-01T16:00:00Z',
				initiator: 'guest'
			})
		);
	});

	test('409s when the row insert loses the race (created not ok)', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(30);
		h.isNewSlotBookable.mockResolvedValue(true);
		h.createAppointment.mockResolvedValue({ ok: false });
		const response = await actions.default(bookEvent(validForm()));
		expect((response as Failure)?.status).toBe(409);
	});

	test('500s when the insert throws', async () => {
		h.parseForm.mockReturnValue(validGuest);
		h.resolveDuration.mockReturnValue(30);
		h.isNewSlotBookable.mockResolvedValue(true);
		h.createAppointment.mockRejectedValue(new Error('db down'));
		const response = await actions.default(bookEvent(validForm()));
		expect((response as Failure)?.status).toBe(500);
	});
});
