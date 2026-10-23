import { describe, expect, test, vi } from 'vitest';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

const mockDb = {
	selectFrom: vi.fn().mockReturnValue({
		select: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				groupBy: vi.fn().mockReturnValue({
					execute: vi.fn().mockResolvedValue([])
				})
			})
		})
	})
};

vi.mock('$lib/server/state', () => ({
	getDb: () => mockDb,
	getConfig: () => validConfig
}));

vi.mock('$lib/server/providers/status', () => ({
	listProviders: vi.fn().mockResolvedValue([]),
	discoverCalendars: vi.fn(),
	probeProvider: vi.fn()
}));

vi.mock('$lib/server/calendar/status', () => ({
	listCalendars: vi.fn().mockResolvedValue([]),
	probeCalendar: vi.fn()
}));

vi.mock('$lib/server/email/status', () => ({
	smtpSummary: vi.fn().mockResolvedValue({
		host: 'smtp.example.com',
		port: 587,
		username: 'mailer',
		sender: 'noreply@example.com',
		defaultRecipient: 'test@example.com',
		observed: { state: 'unknown' }
	}),
	sendTestEmail: vi.fn()
}));

vi.mock('$lib/server/worker', () => ({
	workerReachable: vi.fn().mockResolvedValue(true)
}));

import { sendTestEmail, type SendResult } from '$lib/server/email/status';
import { actions, load } from './+page.server';

type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(): Parameters<typeof load>[0] {
	return {} as Parameters<typeof load>[0];
}

function emailEvent(to: string): Parameters<typeof actions.email>[0] {
	const form = new FormData();
	form.set('to', to);
	const request = new Request('https://book.example.com/admin/health?/email', {
		method: 'POST',
		body: form
	});
	return { request } as Parameters<typeof actions.email>[0];
}

describe('admin/health email action', () => {
	test('returns the successful send result unchanged with the submitted recipient', async () => {
		const to = 'recipient@example.com';
		const sendResult: SendResult = { ok: true, message: `Test email sent to ${to}.` };
		vi.mocked(sendTestEmail).mockResolvedValueOnce(sendResult);

		const result = await actions.email(emailEvent(to));

		expect(sendTestEmail).toHaveBeenLastCalledWith(validConfig, to);
		expect(result).toEqual({ emailResult: sendResult });
	});

	test.each(['wait timed out', '535 Authentication failed'])(
		'returns the failed send result unchanged: %s',
		async (message) => {
			const to = 'another@example.com';
			const sendResult: SendResult = { ok: false, message };
			vi.mocked(sendTestEmail).mockResolvedValueOnce(sendResult);

			const result = await actions.email(emailEvent(to));

			expect(sendTestEmail).toHaveBeenLastCalledWith(validConfig, to);
			expect(result).toEqual({ emailResult: sendResult });
		}
	);
});

describe('admin/health +page.server load', () => {
	test('returns meeting types from config', async () => {
		const result = (await load(loadEvent())) as LoadResult;
		expect(result.meetings).toBeDefined();
		expect(result.meetings.length).toBe(1);
		expect(result.meetings[0]).toMatchObject({
			slug: '30-min-chat',
			title: '30 minute chat',
			visibility: 'public',
			durations: [30]
		});
	});
});
