import { describe, expect, test, vi } from 'vitest';
import { load } from './+page.server';
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
			return null;
		},
		findChainTip: async () => null,
		isChainTerminal: async () => ({ terminal: true })
	};
});

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
