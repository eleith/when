import { describe, expect, test, vi } from 'vitest';
import { validConfig } from '#lib/server/__fixtures__/valid-config.js';

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

vi.mock('#lib/server/state.js', () => ({
	getDb: () => mockDb,
	getConfig: () => validConfig
}));

vi.mock('#lib/server/providers/status.js', () => ({
	listProviders: vi.fn().mockResolvedValue([]),
	discoverCalendars: vi.fn(),
	probeProvider: vi.fn()
}));

vi.mock('#lib/server/calendar/status.js', () => ({
	listCalendars: vi.fn().mockResolvedValue([]),
	probeCalendar: vi.fn()
}));

vi.mock('#lib/server/email/status.js', () => ({
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

vi.mock('#lib/server/worker.js', () => ({
	workerReachable: vi.fn().mockResolvedValue(true)
}));

import { sendTestEmail, type SendResult } from '#lib/server/email/status.js';
import {
	discoverCalendars,
	probeProvider,
	type DiscoveryResult,
	type ProbeResult
} from '#lib/server/providers/status.js';
import { probeCalendar, type CalendarProbeResult } from '#lib/server/calendar/status.js';
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

function providerEvent(provider: string): Parameters<typeof actions.testProvider>[0] {
	const form = new FormData();
	form.set('provider', provider);
	const request = new Request('https://book.example.com/admin/health?/testProvider', {
		method: 'POST',
		body: form
	});
	return { request } as Parameters<typeof actions.testProvider>[0];
}

describe('admin/health provider auth action', () => {
	test.each<[string, ProbeResult]>([
		['dav', { ok: true, message: 'Authenticated.' }],
		['cloud', { ok: false, message: 'wait timed out' }],
		['video', { ok: false, message: '401 Authentication failed' }]
	])(
		'returns the auth test result unchanged for %s without a health notice',
		async (provider, probeResult) => {
			vi.mocked(probeProvider).mockResolvedValueOnce(probeResult);

			const result = await actions.testProvider(providerEvent(provider));

			expect(probeProvider).toHaveBeenLastCalledWith(validConfig, provider);
			expect(result).toEqual({ providerTestResult: { provider, ...probeResult } });
		}
	);
});

function calendarEvent(calendar: string): Parameters<typeof actions.testCalendar>[0] {
	const form = new FormData();
	form.set('calendar', calendar);
	const request = new Request('https://book.example.com/admin/health?/testCalendar', {
		method: 'POST',
		body: form
	});
	return { request } as Parameters<typeof actions.testCalendar>[0];
}

describe('admin/health calendar test action', () => {
	test.each<[string, CalendarProbeResult]>([
		['work', { ok: true, message: '3 busy intervals over the next 30 days.' }],
		['personal', { ok: false, message: 'wait timed out' }],
		['shared', { ok: false, message: '401 Authentication failed' }]
	])('preserves the calendar target and raw test result for %s', async (calendar, probeResult) => {
		vi.mocked(probeCalendar).mockResolvedValueOnce(probeResult);

		const result = await actions.testCalendar(calendarEvent(calendar));

		expect(probeCalendar).toHaveBeenLastCalledWith(validConfig, calendar);
		expect(result).toEqual({ calendarTestResult: { calendar, ...probeResult } });
	});
});

function discoveryEvent(provider: string): Parameters<typeof actions.discover>[0] {
	const form = new FormData();
	form.set('provider', provider);
	const request = new Request('https://book.example.com/admin/health?/discover', {
		method: 'POST',
		body: form
	});
	return { request } as Parameters<typeof actions.discover>[0];
}

describe('admin/health discovery action', () => {
	test.each<[string, DiscoveryResult]>([
		[
			'dav',
			{
				ok: true,
				field: 'href',
				calendars: [
					{ id: 'calendars/owner/work/', name: 'Work', primary: true },
					{ id: 'calendars/owner/personal/', name: 'Personal', primary: false }
				]
			}
		],
		['cloud', { ok: true, field: 'id', calendars: [] }],
		['video', { ok: false, message: '401 Authentication failed' }]
	])(
		'preserves the provider and complete discovery result for %s without a notice',
		async (provider, discoveryResult) => {
			vi.mocked(discoverCalendars).mockResolvedValueOnce(discoveryResult);

			const result = await actions.discover(discoveryEvent(provider));

			expect(discoverCalendars).toHaveBeenLastCalledWith(validConfig, provider);
			expect(result).toEqual({ discoveryResult: { provider, ...discoveryResult } });
		}
	);
});

describe('admin/health +page.server load', () => {
	test('returns meeting types from config', async () => {
		const loaded = await load(loadEvent());
		const result = loaded as LoadResult;
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
