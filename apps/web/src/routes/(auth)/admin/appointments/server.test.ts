import { describe, expect, test, vi, beforeEach } from 'vitest';
import { actions } from './+page.server';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { Appointment } from '@when/db';

const mockDb = {
	selectFrom: vi.fn(),
	executeTakeFirst: vi.fn()
};

const mockAppts: Record<string, Appointment> = {
	'appt-concluded': {
		id: 'appt-concluded',
		event_type_id: '30-min-chat',
		start_time: '2020-05-01T15:00:00Z',
		end_time: '2020-05-01T15:30:00Z',
		guest_name: 'Concluded Booker',
		guest_email: 'concluded@example.com',
		guest_answers: null,
		guest_timezone: null,
		location: 'Meet link',
		status: 'confirmed',
		origin_id: 'appt-concluded',
		cancel_token: 'tok-concluded',
		action_log: null,
		external_event_id: null,
		external_calendar_id: null,
		calendar_revision: 0,
		calendar_synced_revision: null,
		has_possible_conflict: 0,
		ics_sequence: 0,
		event_type_snapshot: JSON.stringify(validConfig.event_types[0]),
		created_at: '',
		updated_at: ''
	},
	'appt-upcoming': {
		id: 'appt-upcoming',
		event_type_id: '30-min-chat',
		start_time: '2099-05-01T15:00:00Z',
		end_time: '2099-05-01T15:30:00Z',
		guest_name: 'Upcoming Booker',
		guest_email: 'upcoming@example.com',
		guest_answers: null,
		guest_timezone: null,
		location: 'Meet link',
		status: 'confirmed',
		origin_id: 'appt-upcoming',
		cancel_token: 'tok-upcoming',
		action_log: null,
		external_event_id: null,
		external_calendar_id: null,
		calendar_revision: 0,
		calendar_synced_revision: null,
		has_possible_conflict: 0,
		ics_sequence: 0,
		event_type_snapshot: JSON.stringify(validConfig.event_types[0]),
		created_at: '',
		updated_at: ''
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
			return mockAppts[id] || null;
		},
		isChainTerminal: async (_db: unknown, id: string) => {
			if (id === 'appt-concluded') {
				return { terminal: true };
			}
			return { terminal: false, reason: 'not_terminal' };
		}
	};
});

const mockPurgeAppointment = vi.fn();
vi.mock('$lib/server/appointment/purge', () => ({
	purgeAppointment: async (_ctx: unknown, input: { appointment: Appointment }) => {
		mockPurgeAppointment(input.appointment.id);
		return { ok: true };
	}
}));

describe('Admin Bulk Actions server actions', () => {
	beforeEach(() => {
		mockPurgeAppointment.mockClear();
	});

	test('bulkDelete deletes terminal appointments successfully', async () => {
		const formData = new FormData();
		formData.append('ids', 'appt-concluded');

		const request = new Request('http://localhost', {
			method: 'POST',
			body: formData
		});

		const result = await actions.bulkDelete({
			request,
			params: {},
			route: { id: '/(auth)/admin/appointments' },
			url: new URL('http://localhost'),
			cookies: {} as any,
			locals: {} as any
		} as any);

		expect(result).toEqual({ success: 'Successfully deleted 1 appointment(s).' });
		expect(mockPurgeAppointment).toHaveBeenCalledWith('appt-concluded');
	});

	test('bulkDelete rejects non-terminal appointments and continues', async () => {
		const formData = new FormData();
		formData.append('ids', 'appt-concluded');
		formData.append('ids', 'appt-upcoming');

		const request = new Request('http://localhost', {
			method: 'POST',
			body: formData
		});

		const result = (await actions.bulkDelete({
			request,
			params: {},
			route: { id: '/(auth)/admin/appointments' },
			url: new URL('http://localhost'),
			cookies: {} as any,
			locals: {} as any
		} as any)) as any;

		expect(result.status).toBe(400);
		expect(result.data.successCount).toBe(1);
		expect(result.data.error).toContain(
			'Delete blocked: Appointment for Upcoming Booker is active/upcoming'
		);
		expect(mockPurgeAppointment).toHaveBeenCalledTimes(1);
		expect(mockPurgeAppointment).toHaveBeenCalledWith('appt-concluded');
	});
});
