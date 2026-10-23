import { beforeEach, describe, expect, test, vi } from 'vitest';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

const h = vi.hoisted(() => ({
	db: {},
	findAppointment: vi.fn(),
	isRescheduleSlotBookable: vi.fn(),
	reschedule: vi.fn(),
	validateReason: vi.fn(),
	resolveDuration: vi.fn()
}));

vi.mock('$lib/server/state', () => ({ getConfig: () => validConfig, getDb: () => h.db }));
vi.mock('@when/db', async (io) => {
	const original = await io<typeof import('@when/db')>();
	return { ...original, findAppointment: h.findAppointment };
});
vi.mock('$lib/server/availability/booking', () => ({
	isRescheduleSlotBookable: h.isRescheduleSlotBookable
}));
vi.mock('$lib/server/appointment/reschedule', () => ({ rescheduleAppointment: h.reschedule }));
vi.mock('$lib/server/appointment/duration', () => ({ resolveDuration: h.resolveDuration }));
vi.mock('$lib/server/appointment/form.server', async (io) => {
	const original = await io<typeof import('$lib/server/appointment/form.server')>();
	return { ...original, validateReason: h.validateReason };
});

import { actions } from './+page.server';

type Failure = { status?: number; data?: { error?: string } };
type Thrown = { status: number; location?: string };
const CURRENT = '2099-05-01T15:00:00Z';
const NEW_SLOT = '2099-05-02T16:00:00Z';
const row = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: CURRENT,
	cancel_token: 'own-token',
	status: 'confirmed'
};

function bookEvent(slot = NEW_SLOT): Parameters<typeof actions.default>[0] {
	const fd = new FormData();
	fd.set('slot', slot);
	fd.set('duration', '60');
	fd.set('reason', 'Moving the meeting');
	return { request: { formData: async () => fd }, params: { id: row.id } } as unknown as Parameters<
		typeof actions.default
	>[0];
}

async function book(slot = NEW_SLOT): Promise<Failure> {
	const response = await actions.default(bookEvent(slot));
	return response as Failure;
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
	h.findAppointment.mockResolvedValue(row);
	h.isRescheduleSlotBookable.mockResolvedValue(true);
	h.resolveDuration.mockReturnValue(60);
	h.validateReason.mockReturnValue({ ok: true, reason: 'Moving the meeting' });
	h.reschedule.mockResolvedValue({ ok: true, appointment: { id: 'appt-2' } });
});

describe('/admin/appointment/[id]/reschedule book action', () => {
	test('needs no guest token, delegates the chosen length excluding self, and reschedules as host', async () => {
		const result = await caught(() => actions.default(bookEvent()));
		expect(result).toMatchObject({ status: 303, location: '/appointment/appt-2' });
		expect(h.findAppointment).toHaveBeenCalledExactlyOnceWith(h.db, row.id);
		expect(h.isRescheduleSlotBookable).toHaveBeenCalledExactlyOnceWith(
			h.db,
			validConfig,
			row.event_type_id,
			validConfig.meetings[row.event_type_id],
			NEW_SLOT,
			60,
			CURRENT
		);
		expect(h.validateReason).toHaveBeenCalledWith(expect.any(FormData), 'rescheduling');
		expect(h.reschedule).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ db: h.db, cfg: validConfig }),
			{
				appointmentId: row.id,
				initiator: 'host',
				newStart: NEW_SLOT,
				newEnd: '2099-05-02T17:00:00Z',
				reason: 'Moving the meeting'
			}
		);
	});

	test('404 without checking availability when the row is missing', async () => {
		h.findAppointment.mockResolvedValue(null);
		const result = await book();
		expect(result.status).toBe(404);
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test.for(['', 'not-a-time', CURRENT])(
		'400 on missing, malformed or unchanged slot %s',
		async (slot) => {
			const result = await book(slot);
			expect(result.status).toBe(400);
			expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
			expect(h.reschedule).not.toHaveBeenCalled();
		}
	);

	test('400 on an invalid length before checking availability', async () => {
		h.resolveDuration.mockReturnValue(null);
		const result = await book();
		expect(result.status).toBe(400);
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test('400 on an invalid reason before checking duration or availability', async () => {
		h.validateReason.mockReturnValue({ ok: false, error: 'too long' });
		const result = await book();
		expect(result.status).toBe(400);
		expect(h.resolveDuration).not.toHaveBeenCalled();
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test('409 without mutation when the checker rejects availability', async () => {
		h.isRescheduleSlotBookable.mockResolvedValue(false);
		const result = await book();
		expect(result.status).toBe(409);
		expect(result.data?.error).toBe('That time is no longer available. Please pick another.');
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test.for([
		['slot_taken', 'That time was just taken. Please pick another.'],
		['gated', 'This appointment can no longer be rescheduled.']
	])('409 when the mutation returns %s', async ([reason, message]) => {
		h.reschedule.mockResolvedValue({ ok: false, reason });
		const result = await book();
		expect(result.status).toBe(409);
		expect(result.data?.error).toBe(message);
	});
});
