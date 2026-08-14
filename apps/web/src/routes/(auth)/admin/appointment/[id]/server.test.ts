import { describe, expect, test, vi, beforeEach } from 'vitest';
import { actions, load } from './+page.server';
import { validConfig } from '$lib/server/__fixtures__/valid-config';
import type { Appointment } from '@when/db';
import type { RequestEvent } from './$types';

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
	location: null,
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
	meeting_snapshot: JSON.stringify(validConfig.meetings['30-min-chat']),
	created_at: '',
	updated_at: ''
};

let currentAppt: Appointment | null = mockAppt;
let currentConfig = {
	...validConfig,
	meetings: {
		...validConfig.meetings,
		'30-min-chat': {
			...validConfig.meetings['30-min-chat'],
			video_chat: { provider: 'google-service' }
		}
	}
};

const mockRunWorkflow = vi.fn();

vi.mock('$lib/server/state', () => ({
	getDb: () => mockDb,
	getConfig: () => currentConfig
}));

vi.mock('@when/db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/db')>();
	return {
		...actual,
		findAppointment: vi.fn(async (_db, id) =>
			currentAppt && currentAppt.id === id ? currentAppt : null
		)
	};
});

vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return {
		...actual,
		getOpenWorkflow: () => ({
			runWorkflow: mockRunWorkflow
		})
	};
});

beforeEach(() => {
	vi.clearAllMocks();
	currentAppt = { ...mockAppt };
	currentConfig = {
		...validConfig,
		meetings: {
			...validConfig.meetings,
			'30-min-chat': {
				...validConfig.meetings['30-min-chat'],
				video_chat: { provider: 'google-service' }
			}
		}
	};
});

describe('admin appointment load', () => {
	test('redirects to public appointment view', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await expect(load({ params: { id: 'appt-1' } } as any)).rejects.toMatchObject({
			status: 303,
			location: '/appointment/appt-1'
		});
	});
});

describe('generateVideoChat action', () => {
	test('returns 404 when appointment does not exist', async () => {
		currentAppt = null;
		const res = await actions.generateVideoChat({
			params: { id: 'missing' }
		} as unknown as RequestEvent);
		expect(res).toEqual({ status: 404, data: { error: 'Appointment not found.' } });
	});

	test('returns 400 when meeting does not have video chat configured', async () => {
		currentConfig = {
			...validConfig,
			meetings: {
				...validConfig.meetings,
				'30-min-chat': {
					...validConfig.meetings['30-min-chat'],
					video_chat: undefined as any // eslint-disable-line @typescript-eslint/no-explicit-any
				}
			}
		};

		const res = await actions.generateVideoChat({
			params: { id: 'appt-1' }
		} as unknown as RequestEvent);
		expect(res).toEqual({
			status: 400,
			data: { error: 'This meeting type does not have video chat configured.' }
		});
	});

	test('triggers workflow and returns generated url on success', async () => {
		mockRunWorkflow.mockResolvedValue({
			result: vi.fn().mockResolvedValue({ url: 'https://meet.google.com/abc-def-ghi' })
		});

		const res = await actions.generateVideoChat({
			params: { id: 'appt-1' }
		} as unknown as RequestEvent);

		expect(mockRunWorkflow).toHaveBeenCalled();
		expect(res).toEqual({
			success: 'video_chat_generated',
			url: 'https://meet.google.com/abc-def-ghi'
		});
	});

	test('returns 500 when workflow fails', async () => {
		mockRunWorkflow.mockResolvedValue({
			result: vi.fn().mockRejectedValue(new Error('Calendar sync timeout'))
		});

		const res = await actions.generateVideoChat({
			params: { id: 'appt-1' }
		} as unknown as RequestEvent);

		expect(res).toEqual({
			status: 500,
			data: { error: 'Failed to generate video chat link: Calendar sync timeout' }
		});
	});
});
