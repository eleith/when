import { expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import type { Database } from '@when/db';
import type { Kysely } from 'kysely';
import type { WhenConfiguration } from '@when/config';
import type { FetchFn } from '@when/calendar';
import type { PurgeAppointmentInput } from '@when/jobs';
import { setWorkerContext } from '../services/context.js';
import type { Logger } from '../services/logger.js';
import { runPurgeAppointment } from './purge-appointment.js';

const config = {
	user: { name: 'Jane', email: 'jane@example.com', timezone: 'America/New_York' },
	url: { app: 'https://when.example.com' },
	calendars: [
		{
			id: 'work',
			type: 'caldav',
			url: 'https://cal.example.com/work/',
			username: 'u',
			password: 'p'
		}
	],
	event_types: []
} as unknown as WhenConfiguration;

function makeStep() {
	const names: string[] = [];
	const step = {
		run: async <T>(cfg: { name: string }, fn: () => Promise<T> | T): Promise<T> => {
			names.push(cfg.name);
			return fn();
		}
	};
	return { step, names };
}

function recordingFetch(status = 204) {
	const calls: { method: string; url: string }[] = [];
	const fetchImpl: FetchFn = async (url, init) => {
		calls.push({ method: (init?.method as string) ?? 'GET', url: String(url) });
		return new Response(null, { status });
	};
	return { fetchImpl, calls };
}

const appt = (over: Record<string, unknown>) => ({
	id: 'a',
	event_type_id: 'chat',
	start_time: '2026-05-01T10:00:00Z',
	end_time: '2026-05-01T10:30:00Z',
	guest_name: 'A',
	guest_email: 'a@example.com',
	location: null,
	status: 'purged' as const,
	cancel_token: 't',
	external_event_id: null,
	external_calendar_id: null,
	...over
});

async function seedDb(rows: Record<string, unknown>[]): Promise<Kysely<Database>> {
	const db = openDb(':memory:');
	await runMigrations(db);
	for (const r of rows) await db.insertInto('appointments').values(appt(r)).execute();
	return db;
}

function useContext(db: Kysely<Database>) {
	const warn = vi.fn();
	const logger: Logger = { debug() {}, info() {}, warn, error() {} } as unknown as Logger;
	setWorkerContext({ config, db, logger, mailer: { send: async () => ({ ok: true as const }) } });
	return { warn };
}

const exists = async (db: Kysely<Database>, id: string) =>
	!!(await db.selectFrom('appointments').select('id').where('id', '=', id).executeTakeFirst());

test('reachable calendar: deletes the remote event and the row', async () => {
	const db = await seedDb([
		{ id: '1', cancel_token: 't1', external_event_id: '1', external_calendar_id: 'work' }
	]);
	try {
		const { warn } = useContext(db);
		const { fetchImpl, calls } = recordingFetch(204);
		const input: PurgeAppointmentInput = {
			rows: [{ id: '1', externalEventId: '1', externalCalendarId: 'work' }]
		};
		const { step, names } = makeStep();

		expect(await runPurgeAppointment(input, step, { fetchImpl })).toBe('purged');
		expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
		expect(names).toEqual(['calendar:1', 'delete:1']);
		expect(await exists(db, '1')).toBe(false);
		expect(warn).not.toHaveBeenCalled();
	} finally {
		await db.destroy();
	}
});

test('unreachable calendar: logs the orphan but still deletes the row', async () => {
	const db = await seedDb([
		{ id: '1', cancel_token: 't1', external_event_id: '1', external_calendar_id: 'work' }
	]);
	try {
		const { warn } = useContext(db);
		const { fetchImpl } = recordingFetch(500);
		const input: PurgeAppointmentInput = {
			rows: [{ id: '1', externalEventId: '1', externalCalendarId: 'work' }]
		};

		expect(await runPurgeAppointment(input, makeStep().step, { fetchImpl })).toBe('purged');
		expect(warn).toHaveBeenCalledWith(
			expect.objectContaining({ appointmentId: '1', externalEventId: '1' }),
			'purge left an orphaned calendar event'
		);
		expect(await exists(db, '1')).toBe(false);
	} finally {
		await db.destroy();
	}
});

test('no remote event: no calendar call, row still deleted', async () => {
	const db = await seedDb([{ id: '1', cancel_token: 't1' }]);
	try {
		useContext(db);
		const { fetchImpl, calls } = recordingFetch();
		const input: PurgeAppointmentInput = {
			rows: [{ id: '1', externalEventId: null, externalCalendarId: null }]
		};
		const { step, names } = makeStep();

		await runPurgeAppointment(input, step, { fetchImpl });
		expect(calls).toHaveLength(0);
		expect(names).toEqual(['delete:1']);
		expect(await exists(db, '1')).toBe(false);
	} finally {
		await db.destroy();
	}
});

test('purges every row in the chain', async () => {
	const db = await seedDb([
		{ id: 'old', cancel_token: 't1' },
		{ id: 'new', cancel_token: 't2', external_event_id: '1', external_calendar_id: 'work' }
	]);
	try {
		useContext(db);
		const { fetchImpl } = recordingFetch(204);
		const input: PurgeAppointmentInput = {
			rows: [
				{ id: 'old', externalEventId: null, externalCalendarId: null },
				{ id: 'new', externalEventId: '1', externalCalendarId: 'work' }
			]
		};

		await runPurgeAppointment(input, makeStep().step, { fetchImpl });
		expect(await exists(db, 'old')).toBe(false);
		expect(await exists(db, 'new')).toBe(false);
	} finally {
		await db.destroy();
	}
});
