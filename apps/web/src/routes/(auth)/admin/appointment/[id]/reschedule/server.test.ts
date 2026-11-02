import { beforeEach, describe, expect, test, vi } from 'vitest';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';

const h = vi.hoisted(() => ({
	db: {},
	findAppointment: vi.fn(),
	isRescheduleSlotBookable: vi.fn(),
	reschedule: vi.fn(),
	validateReason: vi.fn(),
	resolveDuration: vi.fn()
}));

vi.mock('#lib/server/state.js', () => ({ getConfig: () => cfg, getDb: () => h.db }));
vi.mock('@when/db', async (io) => {
	const original = await io<typeof import('@when/db')>();
	return { ...original, findAppointment: h.findAppointment };
});
vi.mock('#lib/server/availability/booking.js', () => ({
	isRescheduleSlotBookable: h.isRescheduleSlotBookable
}));
vi.mock('#lib/server/appointment/reschedule.js', () => ({ rescheduleAppointment: h.reschedule }));
vi.mock('#lib/server/appointment/duration.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/server/appointment/duration.js')>();
	return {
		...original,
		resolveDuration: h.resolveDuration.mockImplementation(original.resolveDuration)
	};
});
vi.mock('#lib/server/appointment/form.server.js', async (io) => {
	const original = await io<typeof import('#lib/server/appointment/form.server.js')>();
	return { ...original, validateReason: h.validateReason };
});

import { actions } from './+page.server';

type Failure = { status?: number; data?: { error?: string } };
type Thrown = { status: number; location?: string };
const cfg = structuredClone(validConfig);
cfg.meetings['30-min-chat'].additional_duration_minutes = [75];

const CURRENT = '2099-05-01T15:00:00Z';
const NEW_SLOT = '2099-05-02T16:00:00Z';
const row = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: CURRENT,
	end_time: '2099-05-01T16:30:00Z',
	cancel_token: 'own-token',
	status: 'confirmed'
};

function bookEvent(slot = NEW_SLOT, duration = 60): Parameters<typeof actions.default>[0] {
	const fd = new FormData();
	fd.set('slot', slot);
	fd.set('duration', String(duration));
	fd.set('reason', 'Moving the meeting');
	return { request: { formData: async () => fd }, params: { id: row.id } } as unknown as Parameters<
		typeof actions.default
	>[0];
}

async function book(slot = NEW_SLOT, duration = 60): Promise<Failure> {
	const response = await actions.default(bookEvent(slot, duration));
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
	h.validateReason.mockReturnValue({ ok: true, reason: 'Moving the meeting' });
	h.reschedule.mockResolvedValue({ ok: true, appointment: { id: 'appt-2' } });
});

describe('/admin/appointment/[id]/reschedule book action', () => {
	test.for([
		{ slot: NEW_SLOT, newStart: NEW_SLOT, duration: 60, newEnd: '2099-05-02T17:00:00Z' },
		{
			slot: '2099-05-01T15:00:00.000Z',
			newStart: CURRENT,
			duration: 60,
			newEnd: '2099-05-01T16:00:00Z'
		},
		{
			slot: '2099-05-01T17:00:00+02:00',
			newStart: CURRENT,
			duration: 120,
			newEnd: '2099-05-01T17:00:00Z'
		},
		{ slot: CURRENT, newStart: CURRENT, duration: 75, newEnd: '2099-05-01T16:15:00Z' }
	])(
		'reschedules as host without a guest token at $slot for $duration minutes',
		async ({ slot, newStart, duration, newEnd }) => {
			const event = bookEvent(slot, duration);
			const form = await event.request.formData();
			form.set('role', 'guest');
			form.set('currentDuration', '240');
			form.set('end_time', '2099-05-01T19:00:00Z');
			const result = await caught(() => actions.default(event));
			expect(result).toMatchObject({ status: 303, location: '/appointment/appt-2' });
			expect(h.findAppointment).toHaveBeenCalledExactlyOnceWith(h.db, row.id);
			expect(h.resolveDuration).toHaveBeenCalledExactlyOnceWith(
				cfg.meetings[row.event_type_id],
				'host',
				form,
				row
			);
			expect(h.resolveDuration.mock.calls[0][3]).toBe(row);
			expect(h.isRescheduleSlotBookable).toHaveBeenCalledExactlyOnceWith(
				h.db,
				cfg,
				row.event_type_id,
				cfg.meetings[row.event_type_id],
				'host',
				newStart,
				duration,
				row
			);
			expect(h.isRescheduleSlotBookable.mock.calls[0][7]).toBe(row);
			expect(h.validateReason).toHaveBeenCalledWith(expect.any(FormData), 'rescheduling');
			expect(h.reschedule).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ db: h.db, cfg }),
				{
					appointmentId: row.id,
					initiator: 'host',
					newStart,
					newEnd,
					reason: 'Moving the meeting'
				}
			);
		}
	);

	test('404 without checking availability when the row is missing', async () => {
		h.findAppointment.mockResolvedValue(null);
		const result = await book();
		expect(result.status).toBe(404);
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test.for(['', 'not-a-time'])('400 on missing or malformed slot %s', async (slot) => {
		const result = await book(slot);
		expect(result.status).toBe(400);
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test.for([CURRENT, '2099-05-01T17:00:00+02:00', '2099-05-01T15:00:00.000Z'])(
		'400 without availability or mutation for an unchanged 90-minute interval: %s',
		async (slot) => {
			h.findAppointment.mockResolvedValue({ ...row, end_time: '2099-05-01T18:30:00+02:00' });
			const result = await book(slot, 90);
			expect(result.status).toBe(400);
			expect(result.data?.error).toBe('Please select a new time or duration.');
			expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
			expect(h.reschedule).not.toHaveBeenCalled();
		}
	);

	test('400 on an arbitrary non-palette length before checking availability', async () => {
		const result = await book(CURRENT, 77);
		expect(result.status).toBe(400);
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test('400 on an invalid reason before checking duration or availability', async () => {
		h.validateReason.mockReturnValue({ ok: false, error: 'too long' });
		const result = await book(CURRENT);
		expect(result.status).toBe(400);
		expect(h.resolveDuration).not.toHaveBeenCalled();
		expect(h.isRescheduleSlotBookable).not.toHaveBeenCalled();
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test('409 without mutation when a longer same-start interval is unavailable', async () => {
		h.isRescheduleSlotBookable.mockResolvedValue(false);
		const result = await book(CURRENT, 120);
		expect(result.status).toBe(409);
		expect(result.data?.error).toBe('That time is no longer available. Please pick another.');
		expect(h.isRescheduleSlotBookable).toHaveBeenCalledExactlyOnceWith(
			h.db,
			cfg,
			row.event_type_id,
			cfg.meetings[row.event_type_id],
			'host',
			CURRENT,
			120,
			row
		);
		expect(h.reschedule).not.toHaveBeenCalled();
	});

	test.for([
		{ reason: 'slot_taken', status: 409, error: 'That time was just taken. Please pick another.' },
		{ reason: 'gated', status: 409, error: 'This appointment can no longer be rescheduled.' },
		{ reason: 'no_changes', status: 400, error: 'Please select a new time or duration.' }
	])('returns $status when the transaction refuses $reason', async ({ reason, status, error }) => {
		h.reschedule.mockResolvedValue({ ok: false, reason });
		const result = await book();
		expect(result.status).toBe(status);
		expect(result.data?.error).toBe(error);
	});
});
