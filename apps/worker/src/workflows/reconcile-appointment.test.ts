import { describe, expect, test, vi, beforeEach } from 'vitest';
import { openDb, runMigrations, parseActionLog } from '@when/db';
import type { Database } from '@when/db';
import type { Kysely } from 'kysely';
import type { ReconcileAppointmentInput } from '@when/jobs';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import type { Mailer } from '../email/smtp.js';
import { sampleInput } from '../email/__fixtures__/appointment.js';
import { runReconcileAppointment } from './reconcile-appointment.js';

import type { WhenConfiguration } from '@when/config';

const input: ReconcileAppointmentInput = {
	appointmentId: 'appt-1',
	emailKind: 'confirmed'
};

const testConfig = {
	...sampleInput.cfg,
	calendars: [],
	services: [],
	meetings: [
		{
			name: '30-min',
			duration_minutes: 30,
			slug: '30-min',
			booking_approval: 'instant',
			booking_calendar: 'cal',
			schedule: 'standard'
		}
	]
} as unknown as WhenConfiguration;

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

function recordingFetch(status = 204) {
	const calls: { method: string; url: string }[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
			calls.push({ method: (init?.method as string) ?? 'GET', url: String(url) });
			return new Response(null, { status });
		}
	);
	return { calls };
}

beforeEach(() => {
	vi.restoreAllMocks();
});

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
			guest_timezone: 'UTC',
			location: null,
			external_event_id: null,
			external_calendar_id: null,
			status: 'confirmed',
			cancel_token: 'tok-1',
			calendar_revision: 0,
			ics_sequence: 0,
			has_possible_conflict: 0,
			meeting_snapshot: null,
			guest_answers: null,
			created_at: '',
			updated_at: ''
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

describe('runReconcileAppointment', () => {
	test('resolves video chat, syncs calendar, and sends email successfully', async () => {
		const db = await seedDb();
		const { mailer, send } = makeMailer();
		send.mockResolvedValue({ ok: true });
		recordingFetch(201); // Mock external CalDAV/Google calendar calls

		setWorkerContext({ config: testConfig, db, logger: createLogger(), mailer });

		const { step, names } = makeStep();
		const result = await runReconcileAppointment(input, step);

		expect(result).toBe('reconciled');
		expect(send).toHaveBeenCalledTimes(2); // guest + host
		expect(names).toEqual([
			'resolve-video-chat',
			'sync-calendar',
			'smtp:jane@example.com',
			'smtp:owner@acme.test',
			'log:result'
		]);
		expect(await readEmailJobStates(db)).toEqual(['done']);
		await db.destroy();
	});

	test('records email:failed when a send keeps failing', async () => {
		const db = await seedDb();
		const { mailer, send } = makeMailer();
		send.mockResolvedValue({ ok: false, reason: 'smtp down' });
		recordingFetch(201);

		setWorkerContext({ config: testConfig, db, logger: createLogger(), mailer });

		const { step } = makeStep();
		const result = await runReconcileAppointment(input, step);

		expect(result).toBe('reconciled');
		expect(await readEmailJobStates(db)).toEqual(['failed']);
		await db.destroy();
	});
});
