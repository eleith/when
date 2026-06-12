import { beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations } from '@when/db';
import type { Database } from '@when/db';
import type { Kysely } from 'kysely';
import type { SendBookingEmailInput } from '@when/jobs';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { sampleInput } from '../email/__fixtures__/booking.js';

vi.mock('../email/smtp.js', () => ({ sendEmail: vi.fn() }));
import { sendEmail } from '../email/smtp.js';
import { runSendBookingEmail } from './send-booking-email.js';

const input: SendBookingEmailInput = {
	kind: 'confirmed',
	appointment: sampleInput.appointment
};

function makeStep() {
	const names: string[] = [];
	const step = {
		run: async <T>(config: { name: string }, fn: () => Promise<T> | T): Promise<T> => {
			names.push(config.name);
			return fn();
		}
	};
	return { step, names };
}

async function seedDb(): Promise<Kysely<Database>> {
	const db = openDb(':memory:');
	await runMigrations(db);
	await db
		.insertInto('appointments')
		.values({
			id: 'appt-1',
			event_type_id: '30-min',
			start_time: '2026-01-05T15:00:00Z',
			end_time: '2026-01-05T15:30:00Z',
			attendee_name: 'Jane Doe',
			attendee_email: 'jane@example.com',
			attendee_notes: null,
			location: null,
			external_event_id: null,
			external_calendar_id: null,
			status: 'confirmed',
			cancel_token: 'tok-1'
		})
		.execute();
	return db;
}

async function readEmailStatus(db: Kysely<Database>) {
	const row = await db
		.selectFrom('appointments')
		.select('email_notification_status')
		.where('id', '=', 'appt-1')
		.executeTakeFirstOrThrow();
	return row.email_notification_status;
}

describe('runSendBookingEmail', () => {
	beforeEach(() => vi.mocked(sendEmail).mockReset());

	test('sends every envelope and records email:ok', async () => {
		const db = await seedDb();
		setWorkerContext({ config: sampleInput.cfg, db, logger: createLogger() });
		vi.mocked(sendEmail).mockResolvedValue({ ok: true });

		const { step, names } = makeStep();
		const result = await runSendBookingEmail(input, step);

		expect(result).toBe('sent');
		expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(2); // attendee + organizer
		expect(names).toEqual(['smtp:jane@example.com', 'smtp:owner@acme.test', 'status']);
		expect(await readEmailStatus(db)).toBe('ok');
		await db.destroy();
	});

	test('records email:failed when a send keeps failing', async () => {
		const db = await seedDb();
		setWorkerContext({ config: sampleInput.cfg, db, logger: createLogger() });
		vi.mocked(sendEmail).mockResolvedValue({ ok: false, reason: 'smtp down' });

		const { step } = makeStep();
		const result = await runSendBookingEmail(input, step);

		expect(result).toBe('skipped');
		expect(await readEmailStatus(db)).toBe('failed');
		await db.destroy();
	});
});
