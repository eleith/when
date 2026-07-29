import { describe, expect, test, vi } from 'vitest';
import { actions, load } from './+page.server';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { Appointment } from '@when/db';

const mockDb = {
	selectFrom: vi.fn(),
	executeTakeFirst: vi.fn()
};

const mockAppt: Appointment = {
	id: 'appt-1',
	event_type_id: '30-min-chat',
	start_time: '2099-05-01T15:00:00Z',
	end_time: '2099-05-01T15:30:00Z',
	guest_name: 'Booker',
	guest_email: 'booker@example.com',
	guest_answers: null,
	guest_timezone: null,
	location: 'Meet link',
	note: null,
	video_chat: null,
	status: 'confirmed',
	origin_id: 'appt-1',
	cancel_token: 'tok-abc',
	action_log: null,
	external_event_id: null,
	external_calendar_id: null,
	calendar_revision: 0,
	calendar_synced_revision: null,
	has_possible_conflict: 0,
	ics_sequence: 0,
	meeting_snapshot: JSON.stringify(validConfig.meetings[0]),
	created_at: '',
	updated_at: ''
};

// A three-row reschedule chain: chain-1 was moved to chain-2, which was moved to chain-3.
// Each row's own log carries the entry naming it as the `next_id`.
function rescheduleLog(previousId: string, nextId: string): string {
	return JSON.stringify([
		{
			action: 'reschedule',
			actor: 'guest',
			at: '2099-04-01T00:00:00Z',
			payload: { metadata: { previous_id: previousId, next_id: nextId } }
		}
	]);
}

const chain: Record<string, Appointment> = {
	'chain-1': {
		...mockAppt,
		id: 'chain-1',
		origin_id: 'chain-1',
		cancel_token: 'tok-1',
		status: 'rescheduled'
	},
	'chain-2': {
		...mockAppt,
		id: 'chain-2',
		origin_id: 'chain-1',
		cancel_token: 'tok-2',
		status: 'rescheduled',
		action_log: rescheduleLog('chain-1', 'chain-2')
	},
	'chain-3': {
		...mockAppt,
		id: 'chain-3',
		origin_id: 'chain-1',
		cancel_token: 'tok-3',
		status: 'confirmed',
		action_log: rescheduleLog('chain-2', 'chain-3')
	}
};

vi.mock('$lib/server/state', () => ({
	getConfig: () => validConfig,
	getDb: () => mockDb
}));

vi.mock('@when/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/db')>();
	return {
		...actual,
		findAppointment: async (_db: unknown, id: string) => {
			if (id === 'appt-1') return mockAppt;
			if (id === 'appt-deleted') return { ...mockAppt, id: 'appt-deleted', event_type_id: 'gone' };
			return chain[id] ?? null;
		},
		findChainTip: async (_db: unknown, origin: string) =>
			origin === 'chain-1' ? chain['chain-3'] : null,
		isChainTerminal: async () => ({ terminal: true })
	};
});

function loadAppointment(id: string, token: string | null, admin = false) {
	const query = token === null ? '' : `?token=${encodeURIComponent(token)}`;
	return load({
		url: new URL(`http://localhost/appointment/${id}${query}`),
		locals: { auth: vi.fn().mockResolvedValue(admin ? { user: { name: 'admin' } } : null) },
		params: { id },
		cookies: { get: vi.fn().mockReturnValue(undefined), delete: vi.fn() }
	} as unknown as Parameters<typeof load>[0]) as Promise<
		Exclude<Awaited<ReturnType<typeof load>>, void>
	>;
}

describe('/appointment/[id] server load', () => {
	test('renders successfully for guest when event type is active', async () => {
		const mockLocals = {
			auth: vi.fn().mockResolvedValue(null)
		};

		const url = new URL('http://localhost/appointment/appt-1?token=tok-abc');
		const mockCookies = {
			get: vi.fn().mockReturnValue(undefined),
			delete: vi.fn()
		};

		const result = (await load({
			url,
			locals: mockLocals,
			params: { id: 'appt-1' },
			cookies: mockCookies
		} as unknown as Parameters<typeof load>[0])) as Exclude<Awaited<ReturnType<typeof load>>, void>;

		expect(result.appointment.id).toBe('appt-1');
		expect(result.eventType.name).toBe('30-min-chat');
		expect(result.actions.cancel.allowed).toBe(true);
	});

	test('throws 404 for guest when event type is missing/deleted from config', async () => {
		const mockLocals = {
			auth: vi.fn().mockResolvedValue(null)
		};

		const url = new URL('http://localhost/appointment/appt-deleted?token=tok-abc');
		const mockCookies = {
			get: vi.fn().mockReturnValue(undefined),
			delete: vi.fn()
		};

		await expect(
			load({
				url,
				locals: mockLocals,
				params: { id: 'appt-deleted' },
				cookies: mockCookies
			} as unknown as Parameters<typeof load>[0])
		).rejects.toThrow();
	});

	test('renders for admin when event type is deleted from config (loads via snapshot)', async () => {
		const mockLocals = {
			auth: vi.fn().mockResolvedValue({ user: { name: 'admin' } })
		};

		const url = new URL('http://localhost/appointment/appt-deleted');
		const mockCookies = {
			get: vi.fn().mockReturnValue(undefined),
			delete: vi.fn()
		};

		const result = (await load({
			url,
			locals: mockLocals,
			params: { id: 'appt-deleted' },
			cookies: mockCookies
		} as unknown as Parameters<typeof load>[0])) as Exclude<Awaited<ReturnType<typeof load>>, void>;

		expect(result.appointment.id).toBe('appt-deleted');
		// Should parse and return details from mockAppt.event_type_snapshot
		expect(result.eventType.name).toBe('30-min-chat');
		// Actions must be locked down to disabled
		expect(result.actions.cancel.allowed).toBe(false);
		expect(result.actions.reschedule.allowed).toBe(false);
		// Delete must be allowed (constraints lifted)
		expect(result.deleteCheck?.terminal).toBe(true);
	});

	test('passes flash message value from cookie to page data', async () => {
		const mockLocals = {
			auth: vi.fn().mockResolvedValue(null)
		};
		const mockCookies = {
			get: vi.fn().mockReturnValue('request'),
			delete: vi.fn()
		};

		const url = new URL('http://localhost/appointment/appt-1?token=tok-abc');
		const result = (await load({
			url,
			locals: mockLocals,
			params: { id: 'appt-1' },
			cookies: mockCookies
		} as unknown as Parameters<typeof load>[0])) as Exclude<Awaited<ReturnType<typeof load>>, void>;

		expect(result.flash).toBe('request');
		expect(mockCookies.delete).toHaveBeenCalledWith('submitted', { path: '/' });
	});
});

describe('/appointment/[id] reschedule chain links — characterization', () => {
	test('a token only opens its own row', async () => {
		await expect(loadAppointment('chain-2', 'tok-1')).rejects.toThrow();
		await expect(loadAppointment('chain-3', 'tok-2')).rejects.toThrow();
		await expect(loadAppointment('chain-1', 'tok-1')).resolves.toBeTruthy();
	});

	test('a row hands back its predecessor together with that predecessor token', async () => {
		const result = await loadAppointment('chain-2', 'tok-2');

		expect(result.rescheduledFrom).toMatchObject({ id: 'chain-1', token: 'tok-1' });
	});

	// C16 inverts this: a superseded row should NOT hand a guest the live row's token.
	test('a superseded row hands back the chain tip together with the tip token', async () => {
		const result = await loadAppointment('chain-1', 'tok-1');

		expect(result.latestAppointment).toEqual({ id: 'chain-3', token: 'tok-3' });
	});

	test('the live row at the tip has no successor to point at', async () => {
		const result = await loadAppointment('chain-3', 'tok-3');

		expect(result.latestAppointment).toBeNull();
		expect(result.rescheduledFrom).toMatchObject({ id: 'chain-2' });
	});

	test('a superseded row offers the guest no actions', async () => {
		const result = await loadAppointment('chain-1', 'tok-1');

		expect(result.actions.cancel).toEqual({ allowed: false, reason: 'terminal_status' });
		expect(result.actions.reschedule).toEqual({ allowed: false, reason: 'terminal_status' });
	});

	test('an admin reaches a row without a token and receives the guest token', async () => {
		const result = await loadAppointment('chain-3', null, true);

		expect(result.isAdmin).toBe(true);
		expect(result.token).toBe('tok-3');
	});

	test('a guest without a token is refused even on a live row', async () => {
		await expect(loadAppointment('chain-3', null)).rejects.toThrow();
	});
});

describe('/appointment/[id] cancel action — characterization', () => {
	function cancelWith(id: string, token: string) {
		const form = new FormData();
		form.set('token', token);
		form.set('reason', 'no longer needed');
		return actions.cancel({
			params: { id },
			request: new Request('http://localhost', { method: 'POST', body: form })
		} as unknown as Parameters<typeof actions.cancel>[0]);
	}

	test('another row token in the chain cannot cancel this row', async () => {
		expect(await cancelWith('chain-3', 'tok-1')).toMatchObject({ status: 403 });
		expect(await cancelWith('chain-3', 'tok-2')).toMatchObject({ status: 403 });
	});

	test('an empty token cannot cancel', async () => {
		expect(await cancelWith('chain-3', '')).toMatchObject({ status: 403 });
	});

	test('an unknown appointment is a 404, not a token check', async () => {
		expect(await cancelWith('nope', 'tok-3')).toMatchObject({ status: 404 });
	});
});
