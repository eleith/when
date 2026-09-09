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

import { load } from './+page.server';

type LoadResult = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(): Parameters<typeof load>[0] {
	return {} as Parameters<typeof load>[0];
}

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
