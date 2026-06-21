import { beforeEach, describe, expect, test, vi } from 'vitest';
import { purgeAppointment } from './purge';
import { systemClock } from '$lib/server/clock';
import { openDb, runMigrations, type Database } from '@when/db';
import type { Kysely } from 'kysely';
import { validConfig } from '$lib/server/__fixtures__/valid-config';

vi.mock('../workflow', () => ({ enqueuePurgeAppointment: vi.fn() }));
import { enqueuePurgeAppointment } from '../workflow';

const baseRow = {
	event_type_id: '30-min-chat',
	start_time: '2099-01-01T15:00:00Z',
	end_time: '2099-01-01T15:30:00Z',
	attendee_name: 'Booker',
	attendee_email: 'booker@example.com',
	attendee_answers: null,
	location: null,
	external_event_id: null,
	external_calendar_id: null
};

async function makeDb() {
	const db = openDb(':memory:');
	await runMigrations(db);
	return db;
}

const insert = (db: Kysely<Database>, overrides: Record<string, unknown>) =>
	db
		.insertInto('appointments')
		.values({ ...baseRow, ...overrides } as never)
		.execute();

const fetchRow = (db: Kysely<Database>, id: string) =>
	db.selectFrom('appointments').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

const ctx = (db: Kysely<Database>) => ({ db, cfg: validConfig, clock: systemClock });

describe('purgeAppointment', () => {
	beforeEach(() => vi.mocked(enqueuePurgeAppointment).mockReset());

	test('purges the whole chain and enqueues the workflow with its rows', async () => {
		const db = await makeDb();
		try {
			await insert(db, { id: 'old', status: 'rescheduled', origin_id: 'old', cancel_token: 't1' });
			await insert(db, {
				id: 'new',
				status: 'cancelled',
				origin_id: 'old',
				cancel_token: 't2',
				external_event_id: 'ev',
				external_calendar_id: 'work'
			});

			const res = await purgeAppointment(ctx(db), { appointment: await fetchRow(db, 'new') });

			expect(res.ok).toBe(true);
			expect((await fetchRow(db, 'old')).status).toBe('purged');
			expect((await fetchRow(db, 'new')).status).toBe('purged');

			const rows = vi.mocked(enqueuePurgeAppointment).mock.calls[0][0];
			expect(rows).toHaveLength(2);
			expect(rows).toEqual(
				expect.arrayContaining([
					{ id: 'old', externalEventId: null, externalCalendarId: null },
					{ id: 'new', externalEventId: 'ev', externalCalendarId: 'work' }
				])
			);
		} finally {
			await db.destroy();
		}
	});

	test('is a no-op when the chain is already purged', async () => {
		const db = await makeDb();
		try {
			await insert(db, { id: 'a', status: 'purged', origin_id: 'a', cancel_token: 't' });

			const res = await purgeAppointment(ctx(db), { appointment: await fetchRow(db, 'a') });

			expect(res).toEqual({ ok: false, reason: 'already_purged' });
			expect(enqueuePurgeAppointment).not.toHaveBeenCalled();
		} finally {
			await db.destroy();
		}
	});
});
