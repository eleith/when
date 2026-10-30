import { beforeEach, describe, expect, test, vi } from 'vitest';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';

const h = vi.hoisted(() => ({
	db: {},
	isNewSlotBookable: vi.fn(),
	createAppointment: vi.fn(),
	parseForm: vi.fn(),
	resolveDuration: vi.fn()
}));

vi.mock('#lib/server/state.js', () => ({ getConfig: () => validConfig, getDb: () => h.db }));
vi.mock('#lib/server/availability/booking.js', () => ({ isNewSlotBookable: h.isNewSlotBookable }));
vi.mock('#lib/server/appointment/create.js', () => ({ createAppointment: h.createAppointment }));
vi.mock('#lib/server/appointment/duration.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/server/appointment/duration.js')>();
	return { ...original, resolveDuration: h.resolveDuration };
});
vi.mock('#lib/server/appointment/form.server.js', async (io) => {
	const original = await io<typeof import('#lib/server/appointment/form.server.js')>();
	return { ...original, parseAndValidateAppointmentForm: h.parseForm };
});

import { actions } from './+page.server';

type Failure = { status?: number; data?: { error?: string } };
type Thrown = { status: number; location?: string };
const SLOT = '2099-05-01T15:00:00Z';
const guest = { name: 'A', email: 'a@b.co', answers: [], location: null };

function bookEvent(slot = SLOT, slug = '30-min-chat'): Parameters<typeof actions.default>[0] {
	const fd = new FormData();
	fd.set('slot', slot);
	fd.set('name', guest.name);
	fd.set('email', guest.email);
	fd.set('duration', '60');
	return { request: { formData: async () => fd }, params: { slug } } as unknown as Parameters<
		typeof actions.default
	>[0];
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
	h.parseForm.mockReturnValue({ ok: true, data: guest });
	h.resolveDuration.mockReturnValue(60);
	h.isNewSlotBookable.mockResolvedValue(true);
	h.createAppointment.mockResolvedValue({ ok: true, appointment: { id: 'new-1' } });
});

describe('/admin/schedule/[slug] book action', () => {
	test('delegates the chosen length and books as host with the configured timezone fallback', async () => {
		const event = bookEvent();
		const form = await event.request.formData();
		form.set('role', 'guest');
		form.set('currentDuration', '300');
		const result = await caught(() => actions.default(event));
		expect(result).toMatchObject({ status: 303, location: '/appointment/new-1' });
		expect(h.resolveDuration).toHaveBeenCalledExactlyOnceWith(
			validConfig.meetings['30-min-chat'],
			'host',
			form
		);
		expect(h.isNewSlotBookable).toHaveBeenCalledExactlyOnceWith(
			h.db,
			validConfig,
			'30-min-chat',
			validConfig.meetings['30-min-chat'],
			'host',
			SLOT,
			60
		);
		expect(h.createAppointment).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ db: h.db, cfg: validConfig }),
			{
				slug: '30-min-chat',
				eventType: validConfig.meetings['30-min-chat'],
				start: SLOT,
				end: '2099-05-01T16:00:00Z',
				guest: {
					name: guest.name,
					email: guest.email,
					answers: [],
					timezone: validConfig.user.timezone
				},
				location: null,
				initiator: 'host'
			}
		);
	});

	test('409 without creating when availability rejects the slot', async () => {
		h.isNewSlotBookable.mockResolvedValue(false);
		const response = await actions.default(bookEvent());
		expect((response as Failure)?.status).toBe(409);
		expect(h.createAppointment).not.toHaveBeenCalled();
	});

	test('400 on an invalid length before checking availability', async () => {
		h.resolveDuration.mockReturnValue(null);
		const response = await actions.default(bookEvent());
		expect((response as Failure)?.status).toBe(400);
		expect(h.isNewSlotBookable).not.toHaveBeenCalled();
		expect(h.createAppointment).not.toHaveBeenCalled();
	});

	test.for(['', 'not-a-time'])(
		'400 on malformed slot %s before checking availability',
		async (slot) => {
			const response = await actions.default(bookEvent(slot));
			expect((response as Failure)?.status).toBe(400);
			expect(h.parseForm).not.toHaveBeenCalled();
			expect(h.isNewSlotBookable).not.toHaveBeenCalled();
			expect(h.createAppointment).not.toHaveBeenCalled();
		}
	);

	test('400 on invalid guest fields before checking availability', async () => {
		h.parseForm.mockReturnValue({ ok: false, errors: { name: 'required' } });
		const response = await actions.default(bookEvent());
		expect((response as Failure)?.status).toBe(400);
		expect(h.isNewSlotBookable).not.toHaveBeenCalled();
		expect(h.createAppointment).not.toHaveBeenCalled();
	});

	test('404 on an unknown meeting', async () => {
		const result = await caught(() => actions.default(bookEvent(SLOT, 'missing')));
		expect(result.status).toBe(404);
		expect(h.isNewSlotBookable).not.toHaveBeenCalled();
	});

	test('409 if the insert loses the race after availability passed', async () => {
		h.createAppointment.mockResolvedValue({ ok: false });
		const response = await actions.default(bookEvent());
		expect((response as Failure)?.data?.error).toBe(
			'That time was just taken. Please pick another.'
		);
		expect((response as Failure)?.status).toBe(409);
	});
});
