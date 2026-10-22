import { describe, expect, test, vi, beforeEach } from 'vitest';
import { actions, load } from './+page.server';
import { requestVideoChat } from '$lib/server/appointment/request-video-chat';
import type { RequestEvent } from './$types';

vi.mock('$lib/server/appointment/context', () => ({ appointmentContext: () => context }));
vi.mock('$lib/server/appointment/request-video-chat', () => ({ requestVideoChat: vi.fn() }));

const context = { db: {}, cfg: {}, clock: {} };
const event = { params: { id: 'appt-1' } } as unknown as RequestEvent;

beforeEach(() => {
	vi.mocked(requestVideoChat).mockReset();
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
