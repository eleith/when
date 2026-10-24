import { describe, expect, test, vi, beforeEach } from 'vitest';
import { actions, load } from './+page.server';
import { requestVideoChat } from '$lib/server/appointment/request-video-chat';
import { changeAppointmentDuration } from '$lib/server/appointment/change-duration';
import type { Appointment } from '@when/db';
import type { RequestEvent } from './$types';

vi.mock('$lib/server/appointment/context', () => ({ appointmentContext: () => context }));
vi.mock('$lib/server/appointment/request-video-chat', () => ({ requestVideoChat: vi.fn() }));
vi.mock('$lib/server/appointment/change-duration', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/server/appointment/change-duration')>();
	return { ...original, changeAppointmentDuration: vi.fn() };
});

const context = { db: {}, cfg: {}, clock: {} };
const event = { params: { id: 'appt-1' } } as unknown as RequestEvent;

beforeEach(() => {
	vi.mocked(requestVideoChat).mockReset();
	vi.mocked(changeAppointmentDuration).mockReset();
});

describe('admin appointment load', () => {
	test('redirects to public appointment view', async () => {
		const loading = load({ params: { id: 'appt-1' } } as Parameters<typeof load>[0]);
		await expect(loading).rejects.toMatchObject({
			status: 303,
			location: '/appointment/appt-1'
		});
	});
});

describe('generateVideoChat action', () => {
	test.each([
		['not_found', 404, 'Appointment not found.'],
		['not_configured', 400, 'This meeting type does not have video chat configured.'],
		['gated', 400, 'This appointment cannot generate a video chat link.']
	] as const)('maps %s from the fresh domain decision', async (reason, status, error) => {
		vi.mocked(requestVideoChat).mockResolvedValue({ ok: false, reason });

		const result = await actions.generateVideoChat(event);

		expect(requestVideoChat).toHaveBeenCalledWith(context, { appointmentId: 'appt-1' });
		expect(result).toEqual({ status, data: { error } });
	});

	test('acknowledges submission without claiming a link was generated', async () => {
		vi.mocked(requestVideoChat).mockResolvedValue({ ok: true, outcome: 'requested' });

		const result = await actions.generateVideoChat(event);

		expect(result).toEqual({ success: 'video_chat_requested' });
	});

	test('labels an existing link as a no-op', async () => {
		vi.mocked(requestVideoChat).mockResolvedValue({ ok: true, outcome: 'already_linked' });

		const result = await actions.generateVideoChat(event);

		expect(result).toEqual({ success: 'video_chat_already_linked' });
	});

	test('reports a saved choice and unconfirmed submission on enqueue failure', async () => {
		vi.mocked(requestVideoChat).mockResolvedValue({
			ok: false,
			reason: 'enqueue_failed',
			choiceSaved: true
		});

		const result = await actions.generateVideoChat(event);

		expect(result).toEqual({
			status: 500,
			data: {
				error:
					'Your video chat choice was saved, but submission could not be confirmed. Please try again.',
				choiceSaved: true
			}
		});
	});
});

describe('changeDuration action', () => {
	function changeDurationWith(form: FormData) {
		return actions.changeDuration({
			params: { id: 'appt-1' },
			request: new Request('http://localhost', { method: 'POST', body: form })
		} as unknown as RequestEvent);
	}

	test.each(['updated', 'unchanged'] as const)(
		'maps %s while passing only the route id and parsed duration to the fresh-row service',
		async (outcome) => {
			// The route does not consume the service's returned row.
			const appointment = { id: 'fresh-service-row' } as Appointment;
			vi.mocked(changeAppointmentDuration).mockResolvedValue({ ok: true, outcome, appointment });
			const form = new FormData();
			form.set('duration', ' 60 ');
			for (const [key, value] of Object.entries({
				id: 'forged-id',
				appointmentId: 'forged-id',
				start: '2000-01-01T00:00:00Z',
				start_time: '2000-01-01T00:00:00Z',
				end_time: '2099-01-01T00:00:00Z',
				role: 'guest',
				viewer: 'host',
				isAdmin: 'true',
				isHost: 'true',
				event_type_id: 'forged-meeting',
				durationMinutes: '300',
				note: 'forged note',
				location: 'forged location',
				video_chat: 'https://forged.example.test'
			})) {
				form.set(key, value);
			}

			const result = await changeDurationWith(form);

			expect(changeAppointmentDuration).toHaveBeenCalledExactlyOnceWith(context, {
				appointmentId: 'appt-1',
				durationMinutes: 60
			});
			expect(result).toEqual({
				success: outcome === 'unchanged' ? 'no_change' : 'duration_changed'
			});
		}
	);

	test.each([
		['missing', null],
		['empty', ''],
		['whitespace', '   '],
		['file', new File(['60'], 'duration.txt')],
		['fractional', '1.5'],
		['zero', '0'],
		['negative', '-15'],
		['NaN', 'NaN'],
		['infinity', 'Infinity'],
		['negative infinity', '-Infinity'],
		['overflow', '1e309'],
		['unsafe integer', '9007199254740992'],
		['nonnumeric', 'sixty']
	] as const)('rejects %s duration before calling the service', async (_label, value) => {
		const form = new FormData();
		if (value !== null) form.set('duration', value);

		const result = await changeDurationWith(form);

		expect(result).toEqual({
			status: 400,
			data: { error: 'Please pick a valid meeting length.' }
		});
		expect(result).not.toHaveProperty('success');
		expect(changeAppointmentDuration).not.toHaveBeenCalled();
	});

	test.each([
		['not_found', 404, 'Appointment not found.'],
		['not_configured', 409, 'This meeting type no longer exists.'],
		['invalid_duration', 400, 'Please pick a valid meeting length.'],
		['past_end', 400, 'Choose a length that ends in the future.'],
		['gated', 400, 'This appointment cannot be edited.'],
		['busy', 409, 'That length overlaps another appointment or busy event.']
	] as const)(
		'maps %s without claiming success or a saved duration',
		async (reason, status, error) => {
			vi.mocked(changeAppointmentDuration).mockResolvedValue({ ok: false, reason });
			const form = new FormData();
			form.set('duration', '60');

			const result = await changeDurationWith(form);

			expect(changeAppointmentDuration).toHaveBeenCalledExactlyOnceWith(context, {
				appointmentId: 'appt-1',
				durationMinutes: 60
			});
			expect(result).toEqual({ status, data: { error } });
			expect(result).not.toHaveProperty('success');
			expect(result).not.toHaveProperty('data.durationSaved');
		}
	);

	test('reports the saved duration but unconfirmed update submission on enqueue failure', async () => {
		vi.mocked(changeAppointmentDuration).mockResolvedValue({
			ok: false,
			reason: 'enqueue_failed',
			durationSaved: true
		});
		const form = new FormData();
		form.set('duration', '60');

		const result = await changeDurationWith(form);

		expect(changeAppointmentDuration).toHaveBeenCalledExactlyOnceWith(context, {
			appointmentId: 'appt-1',
			durationMinutes: 60
		});
		expect(result).toEqual({
			status: 500,
			data: {
				error:
					'The duration was saved, but calendar and email update submission could not be confirmed.',
				durationSaved: true
			}
		});
		expect(result).not.toHaveProperty('success');
	});
});
