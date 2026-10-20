import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, parseActionLog, runMigrations } from '@when/db';
import { sampleAppointment } from '../email/__fixtures__/appointment.js';
import { appendEmailJobLog, appendJobLog } from './job-log.js';

const at = '2026-02-01T12:00:00.000Z';
let db: ReturnType<typeof openDb>;
beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	await db.insertInto('appointments').values(sampleAppointment).execute();
});
afterEach(async () => {
	await db.destroy();
});

async function entries() {
	const row = await db.selectFrom('appointments').select('action_log').executeTakeFirstOrThrow();
	return parseActionLog(row.action_log);
}

describe('conditional email action log', () => {
	test('appends failures and recovery with the supplied timestamp and appointment id', async () => {
		await appendEmailJobLog(db, sampleAppointment.id, 'failed', at);
		await appendEmailJobLog(db, sampleAppointment.id, 'done', at);
		expect(await entries()).toEqual(
			['failed', 'done'].map((state) =>
				expect.objectContaining({
					action: 'email',
					at,
					payload: expect.objectContaining({
						metadata: { state, appointment_id: sampleAppointment.id }
					})
				})
			)
		);
	});

	test.each(['failed', 'done'] as const)(
		'does not append %s after the row is purged',
		async (state) => {
			await appendJobLog(db, sampleAppointment.id, 'calendar', 'done', at);
			const before = await entries();
			await db.updateTable('appointments').set({ status: 'purged' }).execute();
			await appendEmailJobLog(db, sampleAppointment.id, state, at);
			expect(await entries()).toEqual(before);
		}
	);

	test('a missing appointment is a no-op', async () => {
		await expect(appendEmailJobLog(db, 'missing', 'done', at)).resolves.toBeUndefined();
		expect(await entries()).toEqual([]);
	});

	test('does not change the general job logger on purged rows', async () => {
		await db.updateTable('appointments').set({ status: 'purged' }).execute();
		await appendJobLog(db, sampleAppointment.id, 'calendar', 'failed', at);
		expect(await entries()).toEqual([expect.objectContaining({ action: 'calendar' })]);
	});
});
