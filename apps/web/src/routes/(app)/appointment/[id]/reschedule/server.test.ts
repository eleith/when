import { describe, expect, test, vi, beforeEach } from 'vitest';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';
import type { Appointment } from '@when/db';
import type { Meeting } from '@when/config';
import type { AppointmentRole } from '#lib/server/appointment/actions.js';
import { resolveBookingDurations } from '#lib/server/appointment/duration.js';

const h = vi.hoisted(() => ({
	db: {},
	row: { current: null as Appointment | null },
	viewAllowed: vi.fn(),
	classify: vi.fn(),
	reschedule: vi.fn(),
	loadAvailability: vi.fn(),
	isRescheduleSlotBookable: vi.fn(),
	parseForm: vi.fn(),
	resolveTimezone: vi.fn(() => 'UTC'),
	validateReason: vi.fn(),
	resolveDuration: vi.fn(),
	toRescheduleAppointment: vi.fn(),
	toPublicEventType: vi.fn()
}));

vi.mock('#lib/server/state.js', () => ({ getConfig: () => cfg, getDb: () => h.db }));
vi.mock('@when/db', async (io) => {
	const original = await io<typeof import('@when/db')>();
	return {
		...original,
		findAppointment: async () => h.row.current
	};
});
vi.mock('#lib/server/appointment/access.js', () => ({
	isViewAllowed: h.viewAllowed
}));
vi.mock('#lib/server/appointment/reschedule.js', () => ({
	classifyReschedule: h.classify,
	rescheduleAppointment: h.reschedule
}));
vi.mock('#lib/server/availability/booking.js', () => ({
	loadAvailability: h.loadAvailability,
	isRescheduleSlotBookable: h.isRescheduleSlotBookable
}));
vi.mock('#lib/server/appointment/form.server.js', async (io) => {
	const original = await io<typeof import('#lib/server/appointment/form.server.js')>();
	return {
		...original,
		parseAndValidateAppointmentForm: h.parseForm,
		resolveTimezone: h.resolveTimezone,
		validateReason: h.validateReason
	};
});
vi.mock('#lib/server/appointment/duration.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/server/appointment/duration.js')>();
	return {
		...original,
		resolveDuration: h.resolveDuration.mockImplementation(original.resolveDuration)
	};
});
vi.mock('#lib/server/appointment/sanitize.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/server/appointment/sanitize.js')>();
	return {
		...original,
		toRescheduleAppointment: h.toRescheduleAppointment,
		toPublicEventType: h.toPublicEventType.mockImplementation(original.toPublicEventType)
	};
});
vi.mock('@when/config', async (io) => {
	const original = await io<typeof import('@when/config')>();
	return {
		...original,
		resolveFormFields: () => []
	};
});

import { load, actions } from './+page.server';

type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Thrown = { status: number; location?: string };
type Failure = { status?: number; data?: { error?: string } };

const cfg = structuredClone(validConfig);
cfg.meetings['30-min-chat'].additional_duration_minutes = [60, 120];

const CURRENT = '2099-05-01T15:00:00Z';
const NEW_SLOT = '2099-05-02T16:00:00Z';

function appt(): Appointment {
	return {
		id: 'appt-1',
		event_type_id: '30-min-chat',
		start_time: CURRENT,
		end_time: '2099-05-01T16:30:00Z',
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

function bookEvent(fd: FormData, session: unknown = null): Parameters<typeof actions.default>[0] {
	return {
		request: { formData: async () => fd },
		params: { id: 'appt-1' },
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

function form(overrides: Record<string, string> = {}): FormData {
	const fd = new FormData();
	fd.set('slot', NEW_SLOT);
	fd.set('token', 'tok-1');
	for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
	return fd;
}

async function book(fd: FormData): Promise<Failure> {
	const response = await actions.default(bookEvent(fd));
	return response as Failure;
}

beforeEach(() => {
	vi.clearAllMocks();
	h.row.current = appt();
	h.viewAllowed.mockResolvedValue(true);
	h.classify.mockReturnValue({ kind: 'ok' });
	h.loadAvailability.mockImplementation(
		async (
			_db,
			_cfg,
			_slug,
			meeting: Meeting,
			role: AppointmentRole,
			currentAppointment: Appointment
		) => {
			const bookingDurations = resolveBookingDurations(meeting, role, currentAppointment);
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
	h.isRescheduleSlotBookable.mockResolvedValue(true);
	h.resolveTimezone.mockReturnValue('UTC');
	h.validateReason.mockReturnValue({ ok: true, reason: null });
	h.toRescheduleAppointment.mockReturnValue({ id: 'appt-1' });
});

describe('/appointment/[id]/reschedule load', () => {
	test.for(['missing', 'forbidden'])('404s when the appointment is %s', async (kind) => {
		if (kind === 'missing') h.row.current = null;
		else h.viewAllowed.mockResolvedValue(false);
		const result = await caught(() => load(loadEvent()));
		expect(result.status).toBe(404);
		expect(h.loadAvailability).not.toHaveBeenCalled();
	});

	test.for([
		{
			role: 'guest',
			session: null,
			formAction: '/appointment/appt-1/reschedule',
			guestFieldsDisabled: false
		},
		{
			role: 'host',
			session: { user: { name: 'Host' } },
			formAction: '/admin/appointment/appt-1/reschedule',
			guestFieldsDisabled: true
		}
	])(
		'returns the appointment and loads $role availability excluding self',
		async ({ role, session, formAction, guestFieldsDisabled }) => {
			const loaded = await load(loadEvent('tok-1', session));
			const result = loaded as LoadResult;
			expect(result.reschedule.appt).toEqual({ id: 'appt-1' });
			expect(result.reschedule.error).toBeNull();
			expect(result.reschedule.token).toBe('tok-1');
			const availability = await h.loadAvailability.mock.results[0].value;
			expect(result.eventType).toMatchObject({ slug: '30-min-chat', duration_minutes: 90 });
			expect(result.eventType.durations).toBe(availability.bookingDurations.durations);
			expect(result.availability.slotsByDuration).toBe(availability.slotsByDuration);
			expect(Object.keys(result.availability.slotsByDuration).map(Number)).toEqual(
				[...result.eventType.durations].sort((a, b) => a - b)
			);
			expect(h.toRescheduleAppointment).toHaveBeenCalledExactlyOnceWith(h.row.current, role, []);
			expect(h.toPublicEventType).toHaveBeenCalledExactlyOnceWith(
				'30-min-chat',
				cfg.meetings['30-min-chat'],
				role,
				availability.bookingDurations
			);
			expect(h.toPublicEventType.mock.calls[0][3]).toBe(availability.bookingDurations);
			expect(result.role).toBe(role);
			expect(result.formAction).toBe(formAction);
			expect(result.guestFieldsDisabled).toBe(guestFieldsDisabled);
			expect(result).not.toHaveProperty('viewer');
			expect(result).not.toHaveProperty('isAdmin');
			expect(result).not.toHaveProperty('isHost');
			expect(h.loadAvailability).toHaveBeenCalledExactlyOnceWith(
				h.db,
				cfg,
				'30-min-chat',
				cfg.meetings['30-min-chat'],
				role,
				h.row.current
			);
		}
	);

	test('surfaces a classify error and nulls the appointment', async () => {
		h.classify.mockReturnValue({ kind: 'error', code: 'too_late' });
		const loaded = await load(loadEvent());
		const result = loaded as LoadResult;
		expect(result.reschedule.error).toBe('too_late');
		expect(result.reschedule.appt).toBeNull();
		expect(result.guestFieldsDisabled).toBe(false);
	});

	test('does not disable an unrendered guest form for a host reschedule error', async () => {
		h.classify.mockReturnValue({ kind: 'error', code: 'too_late' });
		const loaded = await load(loadEvent('tok-1', { user: { name: 'Host' } }));
		const result = loaded as LoadResult;
		expect(result.reschedule.appt).toBeNull();
		expect(result.formAction).toBe('/admin/appointment/appt-1/reschedule');
		expect(result.guestFieldsDisabled).toBe(false);
	});
});

describe('/appointment/[id]/reschedule book action', () => {
	test('400 on a missing slot', async () => {
		const result = await book(form({ slot: '' }));
		expect(result?.status).toBe(400);
	});

	test('400 on a malformed slot before checking availability', async () => {
		const result = await book(form({ slot: 'not-a-time' }));
		expect(result.status).toBe(400);
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test('400 on an invalid duration before checking availability', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		const result = await book(form({ slot: CURRENT, duration: '75' }));
		expect(result.status).toBe(400);
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test('403 when the appointment is missing', async () => {
		h.row.current = null;
		const result = await book(form());
		expect(result.status).toBe(403);
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
	});

	test('403 when the token does not match the appointment', async () => {
		const result = await book(form({ slot: CURRENT, token: 'wrong' }));
		expect(result?.status).toBe(403);
	});

	test.for([CURRENT, '2099-05-01T17:00:00+02:00', '2099-05-01T15:00:00.000Z'])(
		'400 without availability or mutation for an unchanged interval: %s',
		async (slot) => {
			h.parseForm.mockReturnValue({ ok: true, data: {} });
			h.row.current!.end_time = '2099-05-01T18:30:00+02:00';
			const result = await book(form({ slot, duration: '90' }));
			expect(result.status).toBe(400);
			expect(result.data?.error).toBe('Please select a new time or duration.');
			expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
			expect(h.reschedule).not.toHaveBeenCalled();
		}
	);

	test('400 on invalid form fields', async () => {
		h.parseForm.mockReturnValue({ ok: false, errors: { name: 'x' } });
		const result = await book(form({ slot: CURRENT }));
		expect(result?.status).toBe(400);
	});

	test('400 on an invalid reason', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.validateReason.mockReturnValue({ ok: false, error: 'too long' });
		const result = await book(form({ slot: CURRENT }));
		expect(result?.status).toBe(400);
	});

	test('409 without mutation when a longer same-start interval is unavailable', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.isRescheduleSlotBookable.mockResolvedValue(false);
		const result = await book(form({ slot: CURRENT, duration: '120' }));
		expect(result?.status).toBe(409);
		expect(h.isRescheduleSlotBookable).toHaveBeenCalledWith(
			h.db,
			cfg,
			'30-min-chat',
			cfg.meetings['30-min-chat'],
			'guest',
			CURRENT,
			120,
			h.row.current
		);
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test('rejects a forged host-only length even at the current start', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.isRescheduleSlotBookable.mockResolvedValue(false);
		const fd = form({
			slot: CURRENT,
			duration: '240',
			viewer: 'host',
			role: 'host',
			isAdmin: 'true',
			currentDuration: '240',
			end_time: '2099-05-01T19:00:00Z'
		});
		const result = await book(fd);
		expect(result.status).toBe(400);
		expect(h.resolveDuration).toHaveBeenCalledExactlyOnceWith(
			cfg.meetings['30-min-chat'],
			'guest',
			fd,
			h.row.current
		);
		expect(h.resolveDuration.mock.calls[0][3]).toBe(h.row.current);
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test.for([
		{
			slot: NEW_SLOT,
			newStart: NEW_SLOT,
			duration: 60,
			newEnd: '2099-05-02T17:00:00Z',
			forged: false
		},
		{
			slot: NEW_SLOT,
			newStart: NEW_SLOT,
			duration: 90,
			newEnd: '2099-05-02T17:30:00Z',
			forged: true
		},
		{
			slot: '2099-05-01T15:00:00.000Z',
			newStart: CURRENT,
			duration: 60,
			newEnd: '2099-05-01T16:00:00Z',
			forged: false
		},
		{
			slot: '2099-05-01T17:00:00+02:00',
			newStart: CURRENT,
			duration: 120,
			newEnd: '2099-05-01T17:00:00Z',
			forged: true
		}
	])(
		'reschedules as guest at $slot for $duration minutes, ignoring host flags: $forged',
		async ({ slot, newStart, duration, newEnd, forged }) => {
			h.parseForm.mockReturnValue({ ok: true, data: {} });
			h.reschedule.mockResolvedValue({
				ok: true,
				appointment: { id: 'appt-2', cancel_token: 'tok-2' }
			});
			const session = forged ? { user: { name: 'Host' } } : null;
			const fd = form({
				slot,
				duration: String(duration),
				...(forged ? { viewer: 'host', role: 'host', isAdmin: 'true', currentDuration: '240' } : {})
			});
			const event = bookEvent(fd, session);
			const r = await caught(() => actions.default(event));
			expect(r.status).toBe(303);
			expect(r.location).toBe('/appointment/appt-2?token=tok-2');
			expect(h.resolveDuration).toHaveBeenCalledExactlyOnceWith(
				cfg.meetings['30-min-chat'],
				'guest',
				fd,
				h.row.current
			);
			expect(event.cookies.set).toHaveBeenCalledWith('submitted', 'reschedule', {
				path: '/',
				maxAge: 10,
				httpOnly: true,
				sameSite: 'lax'
			});
			expect(h.isRescheduleSlotBookable).toHaveBeenCalledExactlyOnceWith(
				h.db,
				cfg,
				'30-min-chat',
				cfg.meetings['30-min-chat'],
				'guest',
				newStart,
				duration,
				h.row.current
			);
			expect(h.reschedule).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					newStart,
					newEnd,
					initiator: 'guest'
				})
			);
		}
	);

	test('409 when the reschedule loses the slot race', async () => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.reschedule.mockResolvedValue({ ok: false, reason: 'slot_taken' });
		const result = await book(form());
		expect(result?.status).toBe(409);
	});

	test.for([
		{ reason: 'gated', status: 409, error: 'This appointment can no longer be rescheduled.' },
		{ reason: 'no_changes', status: 400, error: 'Please select a new time or duration.' }
	])('returns $status when the transaction refuses $reason', async ({ reason, status, error }) => {
		h.parseForm.mockReturnValue({ ok: true, data: {} });
		h.reschedule.mockResolvedValue({ ok: false, reason });
		const result = await book(form());
		expect(result?.status).toBe(status);
		expect(result.data?.error).toBe(error);
	});
});
