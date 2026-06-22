import { describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, parseActionLog } from '@when/db';
import type { Database } from '@when/db';
import type { Kysely } from 'kysely';
import type { SendAppointmentEmailInput } from '@when/jobs';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import type { Mailer } from '../email/smtp.js';
import { sampleInput } from '../email/__fixtures__/appointment.js';
import { runSendAppointmentEmail } from './send-appointment-email.js';

const input: SendAppointmentEmailInput = {
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

function makeMailer() {
	const send = vi.fn();
	const mailer: Mailer = { send };
	return { mailer, send };
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
			guest_name: 'Jane Doe',
			guest_email: 'jane@example.com',
			location: null,
			external_event_id: null,
			external_calendar_id: null,
			status: 'confirmed',
			cancel_token: 'tok-1'
		})
		.execute();
	return db;
}

async function readEmailJobStates(db: Kysely<Database>) {
	const row = await db
		.selectFrom('appointments')
		.select('action_log')
		.where('id', '=', 'appt-1')
		.executeTakeFirstOrThrow();
	return parseActionLog(row.action_log)
		.filter((e) => e.action === 'email')
		.map((e) => e.payload?.metadata?.state);
}

describe('runSendAppointmentEmail', () => {
	test('sends every envelope and records email:ok', async () => {
		const db = await seedDb();
		const { mailer, send } = makeMailer();
		send.mockResolvedValue({ ok: true });
		setWorkerContext({ config: sampleInput.cfg, db, logger: createLogger(), mailer });

		const { step, names } = makeStep();
		const result = await runSendAppointmentEmail(input, step);

		expect(result).toBe('sent');
		expect(send).toHaveBeenCalledTimes(2); // guest + host
		expect(names).toEqual(['smtp:jane@example.com', 'smtp:owner@acme.test', 'log:result']);
		expect(await readEmailJobStates(db)).toEqual(['done']);
		await db.destroy();
	});

	test('records email:failed when a send keeps failing', async () => {
		const db = await seedDb();
		const { mailer, send } = makeMailer();
		send.mockResolvedValue({ ok: false, reason: 'smtp down' });
		setWorkerContext({ config: sampleInput.cfg, db, logger: createLogger(), mailer });

		const { step } = makeStep();
		const result = await runSendAppointmentEmail(input, step);

		expect(result).toBe('failed');
		expect(await readEmailJobStates(db)).toEqual(['failed']);
		await db.destroy();
	});
});
