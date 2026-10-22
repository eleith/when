import { afterEach, expect, test, vi } from 'vitest';
import { deleteAppointmentFromCalendar } from '@when/calendar';
import { findAppointment, openDb, runMigrations, type Appointment } from '@when/db';
import type { WhenConfiguration } from '@when/config';
import type { WorkerContext } from './context.js';
import type { Logger } from './logger.js';
import {
	cleanupAppointmentVideoChat,
	cleanupStandaloneVideoChat,
	removeUnusedBookingEvent,
	removeUnusedVideoChat
} from './video-chat-cleanup.js';

const reference = { calendarId: 'work', eventId: 'event' };
const google = { providerName: 'google', calendarEvent: reference, url: null };
const nativeUrl = 'https://meet.google.com/aaa-bbbb-ccc';
const roomUrl = 'https://cloud.example.com/nextcloud/call/room';
const config = {
	providers: {
		google: {
			type: 'google',
			client_id: 'cleanup-tests',
			client_secret: 'secret',
			refresh_token: 'refresh',
			calendars: { work: { id: 'primary' } }
		},
		talk: {
			type: 'nextcloud',
			url: 'https://cloud.example.com/nextcloud/',
			username: 'u',
			password: 'p',
			calendars: {}
		}
	},
	meetings: {
		chat: { video_chat: { provider: 'google', attach: { auto: true } } },
		manual: { video_chat: { provider: 'google', attach: { auto: false } } },
		talk: { video_chat: { provider: 'talk' } }
	}
} as unknown as WhenConfiguration;

const databases: ReturnType<typeof openDb>[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const db of databases.splice(0)) await db.destroy();
});

async function setup(rows: (Partial<Appointment> & { id: string })[] = []) {
	const db = openDb(':memory:');
	databases.push(db);
	await runMigrations(db);
	for (const row of rows) {
		await db
			.insertInto('appointments')
			.values({
				event_type_id: 'chat',
				start_time: '2026-05-01T10:00:00Z',
				end_time: '2026-05-01T10:30:00Z',
				guest_name: 'Guest',
				guest_email: 'guest@example.com',
				guest_timezone: 'UTC',
				status: 'cancelled',
				cancel_token: `token-${row.id}`,
				external_calendar_id: 'work',
				external_event_id: 'event',
				created_at: '',
				updated_at: '',
				...row
			})
			.execute();
	}
	const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
	const ctx: WorkerContext = {
		db,
		config: structuredClone(config),
		logger: logger as unknown as Logger,
		mailer: { send: vi.fn() }
	};
	return { ctx, logger };
}

function provider(
	observed: unknown,
	patch: unknown = undefined,
	readStatus = 200,
	writeStatus = 204
) {
	const calls: { method: string; url: string; body: unknown }[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = String(input);
		if (url.includes('oauth2.googleapis.com/token')) {
			return Response.json({ access_token: 'access', expires_in: 3600 });
		}
		const method = init?.method ?? 'GET';
		calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
		if (method === 'GET') return Response.json(observed, { status: readStatus });
		if (method === 'PATCH' && patch !== undefined) return Response.json(patch);
		return new Response(null, { status: writeStatus });
	});
	return calls;
}

const ready = {
	id: 'event',
	conferenceData: { entryPoints: [{ entryPointType: 'video', uri: nativeUrl }] }
};

test('Nextcloud canonical aliases in any active row protect a room regardless of meeting/provider name', async () => {
	const { ctx } = await setup([
		{
			id: 'active',
			status: 'pending',
			event_type_id: 'unrelated',
			video_chat: 'https://CLOUD.example.com:443/nextcloud/call/%72oom?guest=1#join'
		}
	]);
	const calls = provider(null);
	const removed = await removeUnusedVideoChat(ctx, {
		providerName: 'talk',
		calendarEvent: null,
		url: roomUrl
	});
	expect(removed).toBe(true);
	expect(calls).toEqual([]);
});

test('standalone deletion is best effort and preserves selected SQL evidence', async () => {
	const { ctx, logger } = await setup([
		{
			id: 'old',
			event_type_id: 'talk',
			video_chat: roomUrl,
			external_calendar_id: null,
			external_event_id: null
		}
	]);
	const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
	const cleaned = await cleanupAppointmentVideoChat(ctx, 'old');
	const row = await findAppointment(ctx.db, 'old');
	expect(cleaned).toBe(true);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(logger.warn).toHaveBeenCalledTimes(1);
	expect(row?.video_chat).toBe(roomUrl);
});

test('active selected Nextcloud URL is never deleted, including suppression', async () => {
	const { ctx } = await setup([
		{
			id: 'active',
			event_type_id: 'talk',
			status: 'confirmed',
			video_chat: roomUrl,
			video_chat_request: 'suppress',
			external_calendar_id: null,
			external_event_id: null
		}
	]);
	const calls = provider(null);
	const cleaned = await cleanupAppointmentVideoChat(ctx, 'active');
	expect(cleaned).toBe(true);
	expect(calls).toEqual([]);
});

test('a different Nextcloud origin/path does not protect the candidate', async () => {
	const { ctx } = await setup([
		{ id: 'active', status: 'confirmed', video_chat: 'https://other.example.com/call/room' }
	]);
	const calls = provider(null);
	const removed = await removeUnusedVideoChat(ctx, {
		providerName: 'talk',
		calendarEvent: null,
		url: roomUrl
	});
	expect(removed).toBe(true);
	expect(calls.map((call) => call.method)).toEqual(['DELETE']);
	expect(calls[0].url).toContain('/nextcloud/ocs/v2.php/apps/spreed/api/v4/room/room');
});

test.each([
	{ video_chat: nativeUrl, video_chat_request: 'suppress' as const },
	{ video_chat: null, video_chat_request: 'generate' as const },
	{ video_chat: null, video_chat_request: null }
])(
	'active native selection or current generation intent protects Google: %j',
	async (selection) => {
		const { ctx } = await setup([{ id: 'active', status: 'pending', ...selection }]);
		const calls = provider(ready);
		const removed = await removeUnusedVideoChat(ctx, google);
		expect(removed).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(['GET']);
	}
);

test.each(['ready', 'pending', 'failed'])(
	'conflicting selected custom URL with suppression detaches %s conference, never the booking',
	async (status) => {
		const { ctx } = await setup([
			{
				id: 'active',
				status: 'confirmed',
				video_chat: 'https://custom.example.com/join',
				video_chat_request: 'suppress'
			}
		]);
		const observed =
			status === 'ready'
				? ready
				: {
						id: 'event',
						conferenceData: {
							createRequest: {
								status: { statusCode: status === 'pending' ? 'pending' : 'failure' }
							}
						}
					};
		const calls = provider(observed);
		const cleaned = await cleanupAppointmentVideoChat(ctx, 'active');
		const row = await findAppointment(ctx.db, 'active');
		expect(cleaned).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(['GET', 'PATCH']);
		expect(calls[1].body).toEqual({ conferenceData: null });
		expect(row?.video_chat).toBe('https://custom.example.com/join');
	}
);

test.each([{ id: 'event' }, { id: 'event', conferenceData: null }])(
	'already absent conference is successful without PATCH',
	async (observed) => {
		const { ctx } = await setup();
		const calls = provider(observed);
		const removed = await removeUnusedVideoChat(ctx, google);
		expect(removed).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(['GET']);
	}
);

test.each([
	{ observed: {}, patch: undefined, readStatus: 200 },
	{ observed: ready, patch: undefined, readStatus: 500 },
	{ observed: ready, patch: ready, readStatus: 200 },
	{ observed: ready, patch: null, readStatus: 200 }
])(
	'ambiguous/read failure/unconfirmed removal retains evidence: %j',
	async ({ observed, patch, readStatus }) => {
		const { ctx, logger } = await setup([
			{ id: 'old', status: 'rescheduled', video_chat: nativeUrl }
		]);
		const calls = provider(observed, patch, readStatus);
		const cleaned = await cleanupAppointmentVideoChat(ctx, 'old');
		const row = await findAppointment(ctx.db, 'old');
		expect(cleaned).toBe(false);
		expect(row?.video_chat).toBe(nativeUrl);
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
	}
);

test('cleanup reloads current row and uses the bound Google provider after meeting changes', async () => {
	const { ctx } = await setup([{ id: 'old', status: 'confirmed', video_chat_request: 'suppress' }]);
	delete ctx.config.meetings.chat;
	const calls = provider(ready);
	const cleaned = await cleanupAppointmentVideoChat(ctx, 'old');
	expect(cleaned).toBe(true);
	expect(calls.map((call) => call.method)).toEqual(['GET', 'PATCH']);
});

test('no generation or ready-link adoption during cleanup', async () => {
	const { ctx } = await setup([
		{ id: 'active', status: 'confirmed', video_chat_request: 'suppress' }
	]);
	const calls = provider(ready);
	const cleaned = await cleanupAppointmentVideoChat(ctx, 'active');
	const row = await findAppointment(ctx.db, 'active');
	expect(cleaned).toBe(true);
	expect(row?.video_chat).toBeNull();
	expect(calls.map((call) => call.method)).toEqual(['GET', 'PATCH']);
});

test('booking candidate deletion protects every active reference, even suppression without a URI', async () => {
	const { ctx } = await setup([
		{ id: 'active', status: 'pending', video_chat_request: 'suppress' }
	]);
	const calls = provider(null);
	const deleted = await removeUnusedBookingEvent(ctx, reference);
	expect(deleted).toBe(false);
	expect(calls).toEqual([]);
});

test('unreferenced booking deletion is strict about provider failure', async () => {
	const { ctx } = await setup();
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
	await expect(removeUnusedBookingEvent(ctx, reference)).rejects.toThrow();
});

test('unexpected database errors escape cleanup rather than becoming provider warnings', async () => {
	const { ctx, logger } = await setup();
	provider(ready);
	await ctx.db.schema.dropTable('appointments').execute();
	await expect(cleanupAppointmentVideoChat(ctx, 'missing')).rejects.toThrow();
	await expect(removeUnusedVideoChat(ctx, google)).rejects.toThrow();
	await expect(
		removeUnusedVideoChat(ctx, { providerName: 'talk', calendarEvent: null, url: roomUrl })
	).rejects.toThrow();
	expect(logger.warn).not.toHaveBeenCalled();
});

test.each([
	{ video_chat_request: 'generate' as const, kept: true },
	{ video_chat_request: null, kept: false },
	{ video_chat_request: 'suppress' as const, kept: false }
])(
	'manual-only meeting protects only standing force intent: %j',
	async ({ video_chat_request, kept }) => {
		const { ctx } = await setup([
			{ id: 'active', status: 'confirmed', event_type_id: 'manual', video_chat_request }
		]);
		const calls = provider(ready);
		const removed = await removeUnusedVideoChat(ctx, google);
		expect(removed).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(kept ? ['GET'] : ['GET', 'PATCH']);
	}
);

test('Google references are reloaded after remote observation', async () => {
	const { ctx } = await setup([
		{ id: 'active', status: 'confirmed', video_chat_request: 'suppress' }
	]);
	const calls: string[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		if (String(url).includes('oauth2.googleapis.com/token')) {
			return Response.json({ access_token: 'access', expires_in: 3600 });
		}
		calls.push(init?.method ?? 'GET');
		await ctx.db
			.updateTable('appointments')
			.set({ video_chat: nativeUrl })
			.where('id', '=', 'active')
			.execute();
		return Response.json(ready);
	});
	const removed = await removeUnusedVideoChat(ctx, google);
	expect(removed).toBe(true);
	expect(calls).toEqual(['GET']);
});

test('Google cleanup uses the proven booking binding, not equality of provider configuration names', async () => {
	const { ctx } = await setup();
	ctx.config.providers['video-alias'] = structuredClone(ctx.config.providers.google);
	const calls = provider(ready);
	const removed = await removeUnusedVideoChat(ctx, { ...google, providerName: 'video-alias' });
	expect(removed).toBe(true);
	expect(calls.map((call) => call.method)).toEqual(['GET', 'PATCH']);
});

test('standalone cleanup never observes or detaches a Google conference', async () => {
	const { ctx } = await setup([{ id: 'purged', status: 'purged', video_chat: nativeUrl }]);
	const calls = provider(ready);
	const cleaned = await cleanupStandaloneVideoChat(ctx, 'purged');
	expect(cleaned).toBe(true);
	expect(calls).toEqual([]);
});

test('standalone cleanup removes Nextcloud rooms even with a Google booking', async () => {
	const { ctx } = await setup([
		{ id: 'purged', status: 'purged', event_type_id: 'talk', video_chat: roomUrl }
	]);
	const calls = provider(ready);
	const cleaned = await cleanupStandaloneVideoChat(ctx, 'purged');
	const row = await findAppointment(ctx.db, 'purged');
	expect(cleaned).toBe(true);
	expect(calls.map((call) => [call.method, new URL(call.url).hostname])).toEqual([
		['DELETE', 'cloud.example.com']
	]);
	expect(row?.video_chat).toBe(roomUrl);
});

test.each(['cancelled', 'declined', 'expired', 'purged'] as const)(
	'%s cleanup defers an externally deleted Google booking to strict idempotent deletion',
	async (status) => {
		const { ctx } = await setup([{ id: 'terminal', status, video_chat: nativeUrl }]);
		const calls = provider(null, undefined, 404, 404);
		const cleaned = await cleanupAppointmentVideoChat(ctx, 'terminal');
		expect(cleaned).toBe(true);
		expect(calls).toEqual([]);
		const deleted = await deleteAppointmentFromCalendar(
			ctx.config,
			reference.calendarId,
			reference.eventId
		);
		const row = await findAppointment(ctx.db, 'terminal');
		expect(deleted.ok).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(['DELETE']);
		expect(row?.video_chat).toBe(nativeUrl);
	}
);

test.each(['missing-meeting', 'no-video-config', 'manual', 'auto'])(
	'active URI-null without explicit suppression preserves an external conference: %s',
	async (configuration) => {
		const { ctx } = await setup([
			{
				id: 'active',
				status: 'confirmed',
				event_type_id: configuration === 'manual' ? 'manual' : 'chat'
			}
		]);
		if (configuration === 'missing-meeting') delete ctx.config.meetings.chat;
		if (configuration === 'no-video-config') delete ctx.config.meetings.chat.video_chat;
		const calls = provider(ready);
		const cleaned = await cleanupAppointmentVideoChat(ctx, 'active');
		expect(cleaned).toBe(true);
		expect(calls).toEqual([]);
	}
);

test('active selected native URL remains protected despite explicit suppression', async () => {
	const { ctx } = await setup([
		{ id: 'active', status: 'pending', video_chat: nativeUrl, video_chat_request: 'suppress' }
	]);
	const calls = provider(ready);
	const cleaned = await cleanupAppointmentVideoChat(ctx, 'active');
	expect(cleaned).toBe(true);
	expect(calls.map((call) => call.method)).toEqual(['GET']);
});

test('terminal Google booking cleanup still removes an independent Nextcloud room', async () => {
	const { ctx } = await setup([
		{ id: 'terminal', status: 'cancelled', event_type_id: 'talk', video_chat: roomUrl }
	]);
	const calls = provider(ready);
	const cleaned = await cleanupAppointmentVideoChat(ctx, 'terminal');
	expect(cleaned).toBe(true);
	expect(calls.map((call) => [call.method, new URL(call.url).hostname])).toEqual([
		['DELETE', 'cloud.example.com']
	]);
});

test.each([204, 404])(
	'booking candidate cleanup confirms deletion, including already gone: HTTP %s',
	async (status) => {
		const { ctx } = await setup();
		const calls = provider(null, undefined, 200, status);
		const deleted = await removeUnusedBookingEvent(ctx, reference);
		expect(deleted).toBe(true);
		expect(calls.map((call) => call.method)).toEqual(['DELETE']);
	}
);
