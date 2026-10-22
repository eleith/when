import { afterEach, expect, test, vi } from 'vitest';
import { findAppointment, openDb, runMigrations, type Appointment } from '@when/db';
import { sql } from 'kysely';
import type { RetryPolicy } from 'openworkflow';
import type { WhenConfiguration } from '@when/config';
import { setWorkerContext } from '../services/context.js';
import type { Logger } from '../services/logger.js';
import { runPurgeAppointment } from './purge-appointment.js';

const config = {
	providers: {
		dav: {
			type: 'caldav',
			url: 'https://cal.example.com/work/',
			username: 'u',
			password: 'p',
			calendars: { work: { href: 'https://cal.example.com/work/' } }
		},
		talk: {
			type: 'nextcloud',
			url: 'https://talk.example.com',
			username: 'u',
			password: 'p',
			calendars: {}
		}
	},
	meetings: { chat: { video_chat: { provider: 'talk' } } }
} as unknown as WhenConfiguration;

const input = {
	rows: [{ id: 'purged', externalEventId: 'event', externalCalendarId: 'work' }]
};
const databases: ReturnType<typeof openDb>[] = [];

afterEach(async () => {
	vi.restoreAllMocks();
	for (const db of databases.splice(0)) await db.destroy();
});

function makeStep() {
	const names: string[] = [];
	const policies: (Partial<RetryPolicy> | undefined)[] = [];
	const step = {
		run: async <T>(
			cfg: { name: string; retryPolicy?: Partial<RetryPolicy> },
			fn: () => Promise<T> | T
		): Promise<T> => {
			names.push(cfg.name);
			policies.push(cfg.retryPolicy);
			const result = await fn();
			return result;
		}
	};
	return { step, names, policies };
}

async function setup(
	extra: (Partial<Appointment> & { id: string })[] = [],
	contextConfig = config
) {
	const db = openDb(':memory:');
	databases.push(db);
	await runMigrations(db);
	for (const row of [{ id: 'purged' }, ...extra]) {
		await db
			.insertInto('appointments')
			.values({
				event_type_id: 'chat',
				start_time: '2026-05-01T10:00:00Z',
				end_time: '2026-05-01T10:30:00Z',
				guest_name: 'Guest',
				guest_email: 'guest@example.com',
				guest_timezone: 'UTC',
				status: 'purged',
				cancel_token: `token-${row.id}`,
				external_event_id: 'event',
				external_calendar_id: 'work',
				video_chat: 'https://talk.example.com/call/room',
				created_at: '',
				updated_at: '',
				...row
			})
			.execute();
	}
	const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() };
	setWorkerContext({
		config: contextConfig,
		db,
		logger: logger as unknown as Logger,
		mailer: { send: vi.fn() }
	});
	return { db, logger };
}

function provider(calendarStatus = 204, videoStatus = 204) {
	const calls: { method: string; url: string }[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		calls.push({ method: init?.method ?? 'GET', url: String(url) });
		const status = String(url).includes('cal.example.com') ? calendarStatus : videoStatus;
		return new Response(null, { status });
	});
	return calls;
}

test('remote cleanup precedes booking deletion and local deletion; calendar keeps its retry budget', async () => {
	const { db, logger } = await setup();
	const calls = provider();
	const { step, names, policies } = makeStep();
	const result = await runPurgeAppointment(input, step);
	const row = await findAppointment(db, 'purged');
	expect(result).toBe('purged');
	expect(names).toEqual(['video-chat-cleanup:purged', 'calendar:purged', 'delete:purged']);
	expect(policies).toEqual([
		undefined,
		{ maximumAttempts: 30, initialInterval: '1m', backoffCoefficient: 2, maximumInterval: '1h' },
		undefined
	]);
	expect(calls.map((call) => new URL(call.url).hostname)).toEqual([
		'talk.example.com',
		'cal.example.com'
	]);
	expect(row).toBeUndefined();
	expect(logger.warn).not.toHaveBeenCalled();
});

test('unconfirmed calendar deletion retains the row and its selected cleanup evidence', async () => {
	const { db } = await setup();
	provider(500);
	const { step, names } = makeStep();
	await expect(runPurgeAppointment(input, step)).rejects.toThrow();
	const row = await findAppointment(db, 'purged');
	expect(names).toEqual(['video-chat-cleanup:purged', 'calendar:purged']);
	expect(row?.video_chat).toBe('https://talk.example.com/call/room');
	expect(row?.external_event_id).toBe('event');
});

test('active inherited booking and canonical room references survive purge', async () => {
	const { db } = await setup([
		{
			id: 'successor',
			status: 'pending',
			video_chat_request: 'suppress',
			video_chat: 'https://TALK.example.com:443/call/%72oom?join=1'
		}
	]);
	const calls = provider();
	const result = await runPurgeAppointment(input, makeStep().step);
	const purged = await findAppointment(db, 'purged');
	const successor = await findAppointment(db, 'successor');
	expect(result).toBe('purged');
	expect(calls).toEqual([]);
	expect(purged).toBeUndefined();
	expect(successor?.external_event_id).toBe('event');
});

test('active suppressed successor with no selected URI still protects the booking', async () => {
	await setup([
		{ id: 'successor', status: 'confirmed', video_chat: null, video_chat_request: 'suppress' }
	]);
	const calls = provider();
	await runPurgeAppointment(input, makeStep().step);
	expect(calls).toHaveLength(1);
	expect(new URL(calls[0].url).hostname).toBe('talk.example.com');
});

test('standalone room failure remains best effort', async () => {
	const { db, logger } = await setup();
	provider(204, 500);
	const result = await runPurgeAppointment(input, makeStep().step);
	const row = await findAppointment(db, 'purged');
	expect(result).toBe('purged');
	expect(row).toBeUndefined();
	expect(logger.warn).toHaveBeenCalledTimes(1);
});

test('no remote booking: cleanup then delete without a calendar call', async () => {
	const { db } = await setup();
	await db
		.updateTable('appointments')
		.set({ external_event_id: null, external_calendar_id: null })
		.execute();
	const calls = provider();
	const { step, names } = makeStep();
	await runPurgeAppointment(
		{ rows: [{ id: 'purged', externalEventId: null, externalCalendarId: null }] },
		step
	);
	expect(names).toEqual(['video-chat-cleanup:purged', 'calendar:purged', 'delete:purged']);
	expect(calls).toHaveLength(1);
});

test('opaque step rejection escapes unchanged', async () => {
	const { db } = await setup();
	const rejection = new Error('opaque step rejection');
	const run = vi.fn().mockRejectedValue(rejection);
	await expect(runPurgeAppointment(input, { run })).rejects.toBe(rejection);
	const row = await findAppointment(db, 'purged');
	expect(run).toHaveBeenCalledTimes(1);
	expect(row).toBeDefined();
});

test('local deletion failure escapes and retains the row', async () => {
	const { db } = await setup();
	provider();
	await sql
		.raw(
			`CREATE TRIGGER fail_cleanup BEFORE DELETE ON appointments
		BEGIN SELECT RAISE(FAIL, 'local cleanup failed'); END`
		)
		.execute(db);
	await expect(runPurgeAppointment(input, makeStep().step)).rejects.toThrow('local cleanup failed');
	const row = await findAppointment(db, 'purged');
	expect(row?.video_chat).toBe('https://talk.example.com/call/room');
});

const googleConfig = {
	providers: {
		google: {
			type: 'google',
			client_id: 'purge-test',
			client_secret: 'secret',
			refresh_token: 'refresh',
			calendars: { work: { id: 'primary' } }
		},
		talk: config.providers.talk
	},
	meetings: { chat: { video_chat: { provider: 'google' } } }
} as unknown as WhenConfiguration;

test.each([204, 404, 500])(
	'Google booking deletion subsumes conference cleanup: HTTP %s',
	async (status) => {
		const nativeUrl = 'https://meet.google.com/aaa-bbbb-ccc';
		const { db } = await setup([], googleConfig);
		await db.updateTable('appointments').set({ video_chat: nativeUrl }).execute();
		const calls: string[] = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			if (String(url).includes('oauth2.googleapis.com/token')) {
				return Response.json({ access_token: 'access', expires_in: 3600 });
			}
			calls.push(init?.method ?? 'GET');
			return new Response(null, { status });
		});
		if (status === 500) {
			await expect(runPurgeAppointment(input, makeStep().step)).rejects.toThrow();
		} else {
			const result = await runPurgeAppointment(input, makeStep().step);
			expect(result).toBe('purged');
		}
		const row = await findAppointment(db, 'purged');
		expect(calls).toEqual(['DELETE']);
		if (status === 500) expect(row?.video_chat).toBe(nativeUrl);
		else expect(row).toBeUndefined();
	}
);

test('an active Google booking reference protects its conference without reading/detaching it', async () => {
	const { db } = await setup(
		[{ id: 'successor', status: 'pending', video_chat: null, video_chat_request: 'suppress' }],
		googleConfig
	);
	const calls = provider();
	await runPurgeAppointment(input, makeStep().step);
	const purged = await findAppointment(db, 'purged');
	const successor = await findAppointment(db, 'successor');
	expect(calls).toEqual([]);
	expect(purged).toBeUndefined();
	expect(successor?.external_event_id).toBe('event');
});

test.each([null, 'stale-event'])(
	'current booking reference overrides the enqueue snapshot: %s',
	async (snapshotEvent) => {
		const { db } = await setup();
		await db.updateTable('appointments').set({ external_event_id: 'late-booking' }).execute();
		const calls = provider();
		await runPurgeAppointment(
			{
				rows: [
					{
						id: 'purged',
						externalEventId: snapshotEvent,
						externalCalendarId: snapshotEvent ? 'stale-calendar' : null
					}
				]
			},
			makeStep().step
		);
		expect(calls).toHaveLength(2);
		expect(calls[1].url).toContain('/work/late-booking.ics');
	}
);

test('a current row without a booking does not revive a stale input reference', async () => {
	const { db } = await setup();
	await db
		.updateTable('appointments')
		.set({ external_event_id: null, external_calendar_id: null })
		.execute();
	const calls = provider();
	await runPurgeAppointment(input, makeStep().step);
	expect(calls).toHaveLength(1);
	expect(new URL(calls[0].url).hostname).toBe('talk.example.com');
});

test('missing current row falls back to the input booking reference', async () => {
	const { db } = await setup();
	await db.deleteFrom('appointments').execute();
	const calls = provider();
	await runPurgeAppointment(input, makeStep().step);
	expect(calls).toHaveLength(1);
	expect(calls[0].url).toContain('/work/event.ics');
});

test('active references protect the current booking, not merely the stale snapshot', async () => {
	const { db } = await setup([{ id: 'successor', status: 'pending', video_chat: null }]);
	await db.updateTable('appointments').set({ external_event_id: 'late-booking' }).execute();
	const calls = provider();
	await runPurgeAppointment(input, makeStep().step);
	expect(calls).toHaveLength(1);
	expect(new URL(calls[0].url).hostname).toBe('talk.example.com');
});
