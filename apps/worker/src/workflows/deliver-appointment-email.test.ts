import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, parseActionLog, runMigrations } from '@when/db';
import type { RetryPolicy } from 'openworkflow';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import type { Envelope } from '../email/recipients.js';
import type { SendResult } from '../email/smtp.js';
import * as status from '../email/status.js';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { emailsTotal } from '../services/metrics.js';
import {
	deliverAppointmentEmail,
	runDeliverAppointmentEmail
} from './deliver-appointment-email.js';

const at = '2026-02-01T12:00:00.000Z';
const clock = { now: () => new Date(at) };
const envelope: Envelope = { to: 'jane@example.com', subject: 'Prepared', text: 'Saved content' };
const input = {
	appointmentId: sampleAppointment.id,
	kind: 'confirmed',
	role: 'guest',
	envelope
} as const;

type StepConfig = { name: string; retryPolicy?: Partial<RetryPolicy> };
function directStep(before?: (config: StepConfig) => Promise<void>) {
	const configs: StepConfig[] = [];
	return {
		configs,
		async run<T>(config: StepConfig, fn: () => Promise<T> | T): Promise<T> {
			configs.push(config);
			await before?.(config);
			return fn();
		}
	};
}

let db: ReturnType<typeof openDb>;
let send: ReturnType<typeof vi.fn<(envelope: Envelope) => Promise<SendResult>>>;
beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	await db.insertInto('appointments').values(sampleAppointment).execute();
	send = vi.fn(async () => ({ ok: true }));
	setWorkerContext({ db, config: sampleConfig, logger: createLogger(), mailer: { send } });
});
afterEach(async () => {
	vi.restoreAllMocks();
	await db.destroy();
});

async function emailEntries() {
	const row = await db.selectFrom('appointments').select('action_log').executeTakeFirstOrThrow();
	return parseActionLog(row.action_log).filter((entry) => entry.action === 'email');
}

describe('delivery attempt boundaries', () => {
	test('uses the internal spec and five native SMTP attempts, then a separate success checkpoint', async () => {
		const step = directStep();
		expect(deliverAppointmentEmail.name).toBe('deliver-appointment-email');
		await expect(runDeliverAppointmentEmail(input, step, clock)).resolves.toBe('sent');
		expect(step.configs).toEqual([
			{
				name: 'smtp',
				retryPolicy: {
					maximumAttempts: 5,
					initialInterval: '30s',
					backoffCoefficient: 2,
					maximumInterval: '10m'
				}
			},
			{ name: 'smtp:status' }
		]);
		expect(send).toHaveBeenCalledExactlyOnceWith(envelope);
		expect(await emailEntries()).toEqual([]);
		expect(
			await db.selectFrom('service_status').selectAll().executeTakeFirstOrThrow()
		).toMatchObject({
			kind: 'smtp',
			error: null,
			via: 'send',
			last_attempt_at: at,
			last_ok_at: at
		});
	});

	test('records an observed failure inside the callback before throwing to the engine', async () => {
		send.mockResolvedValue({ ok: false, reason: 'SMTP unavailable' });
		const increment = vi.spyOn(emailsTotal, 'inc');
		const step = directStep();
		await expect(runDeliverAppointmentEmail(input, step, clock)).rejects.toThrow(
			'SMTP unavailable'
		);
		expect(step.configs.map((config) => config.name)).toEqual(['smtp']);
		expect(increment).toHaveBeenCalledWith({
			recipient_type: 'guest',
			email_kind: 'confirmed',
			status: 'failure'
		});
		expect(await emailEntries()).toEqual([
			expect.objectContaining({
				at,
				payload: expect.objectContaining({
					metadata: expect.objectContaining({
						state: 'failed',
						appointment_id: input.appointmentId
					})
				})
			})
		]);
		expect(
			await db
				.selectFrom('service_status')
				.select(['error', 'last_attempt_at', 'failing_since'])
				.executeTakeFirstOrThrow()
		).toEqual({ error: 'SMTP unavailable', last_attempt_at: at, failing_since: at });
	});

	test.each(['missing', 'purged'] as const)(
		'checks live %s eligibility inside the SMTP callback',
		async (state) => {
			const step = directStep(async ({ name }) => {
				if (name !== 'smtp') return;
				if (state === 'missing') await db.deleteFrom('appointments').execute();
				else await db.updateTable('appointments').set({ status: 'purged' }).execute();
			});
			await expect(runDeliverAppointmentEmail(input, step, clock)).resolves.toBe('skipped');
			expect(send).not.toHaveBeenCalled();
			expect(await db.selectFrom('service_status').selectAll().execute()).toEqual([]);
			if (state === 'purged') expect(await emailEntries()).toEqual([]);
		}
	);

	test('a success-status error escapes without a provider-failure log or metric', async () => {
		const fault = new Error('local status write failed');
		vi.spyOn(status, 'recordSendOutcome').mockRejectedValueOnce(fault);
		const increment = vi.spyOn(emailsTotal, 'inc');
		const step = directStep();
		await expect(runDeliverAppointmentEmail(input, step, clock)).rejects.toBe(fault);
		expect(step.configs.map((config) => config.name)).toEqual(['smtp', 'smtp:status']);
		expect(send).toHaveBeenCalledTimes(1);
		expect(await emailEntries()).toEqual([]);
		expect(increment).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'failure' }));
	});

	test('does not catch opaque errors from a durable call', async () => {
		const opaque = { marker: 'engine control flow' };
		const step = {
			run: vi.fn(async () => {
				throw opaque;
			})
		};
		await expect(runDeliverAppointmentEmail(input, step, clock)).rejects.toBe(opaque);
		expect(send).not.toHaveBeenCalled();
		expect(await emailEntries()).toEqual([]);
	});
});
