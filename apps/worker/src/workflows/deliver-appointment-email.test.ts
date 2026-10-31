import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, parseActionLog, runMigrations } from '@when/db';
import type { RetryPolicy } from 'openworkflow';
import { sampleAppointment, sampleConfig } from '../email/__fixtures__/appointment.js';
import type { Envelope } from '../email/recipients.js';
import type { SendResult } from '../email/smtp.js';
import * as status from '../email/status.js';
import { setWorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import { emailsTotal, operationFailuresTotal, register } from '../metrics/registry.js';
import { observeMailer } from '../metrics/email.js';
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
	emailsTotal.reset();
	operationFailuresTotal.reset();
	db = openDb(':memory:');
	await runMigrations(db);
	await db.insertInto('appointments').values(sampleAppointment).execute();
	send = vi.fn(async () => ({ ok: true }));
	setWorkerContext({
		db,
		config: sampleConfig,
		logger: createLogger(),
		mailer: observeMailer({ send })
	});
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
		const entries = await emailEntries();
		expect(entries).toEqual([]);
		const smtp = await db.selectFrom('service_status').selectAll().executeTakeFirstOrThrow();
		expect(smtp).toMatchObject({
			kind: 'smtp',
			error: null,
			via: 'send',
			last_attempt_at: at,
			last_ok_at: at
		});
	});

	test('records an observed failure inside the callback before throwing to the engine', async () => {
		send.mockResolvedValue({ ok: false, reason: 'SMTP unavailable', code: 'unknown' });

		const step = directStep();
		await expect(runDeliverAppointmentEmail(input, step, clock)).rejects.toThrow(
			'SMTP unavailable'
		);
		expect(step.configs.map((config) => config.name)).toEqual(['smtp']);

		const entries = await emailEntries();
		expect(entries).toEqual([
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
		const smtp = await db
			.selectFrom('service_status')
			.select(['error', 'last_attempt_at', 'failing_since'])
			.executeTakeFirstOrThrow();
		expect(smtp).toEqual({ error: 'SMTP unavailable', last_attempt_at: at, failing_since: at });
	});

	test.each([
		{ name: 'successful', result: { ok: true } },
		{ name: 'failed', result: { ok: false, reason: 'SMTP unavailable', code: 'unknown' } }
	] as const)('captures the $name attempt time before recording its status', async ({ result }) => {
		const sentAt = '2026-02-01T12:01:00.000Z';
		const writtenAt = '2026-02-01T12:10:00.000Z';
		let now = at;
		const attemptClock = { now: () => new Date(now) };
		send.mockImplementation(async () => {
			now = sentAt;
			return result;
		});
		const record = status.recordSendOutcome;
		vi.spyOn(status, 'recordSendOutcome').mockImplementation(async (...args) => {
			now = writtenAt;
			await record(...args);
		});

		const delivery = runDeliverAppointmentEmail(input, directStep(), attemptClock);
		if (result.ok) await expect(delivery).resolves.toBe('sent');
		else await expect(delivery).rejects.toThrow(result.reason);

		const smtp = await db.selectFrom('service_status').selectAll().executeTakeFirstOrThrow();
		expect(smtp.last_attempt_at).toBe(sentAt);
		if (result.ok) expect(smtp.last_ok_at).toBe(sentAt);
		else expect(smtp.failing_since).toBe(sentAt);
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
			const observations = await db.selectFrom('service_status').selectAll().execute();
			expect(observations).toEqual([]);
			if (state === 'purged') {
				const entries = await emailEntries();
				expect(entries).toEqual([]);
			}
		}
	);

	test('a success-status error escapes without a provider-failure log', async () => {
		const fault = new Error('local status write failed');
		vi.spyOn(status, 'recordSendOutcome').mockRejectedValueOnce(fault);

		const step = directStep();
		await expect(runDeliverAppointmentEmail(input, step, clock)).rejects.toBe(fault);
		expect(step.configs.map((config) => config.name)).toEqual(['smtp', 'smtp:status']);
		expect(send).toHaveBeenCalledTimes(1);
		const entries = await emailEntries();
		expect(entries).toEqual([]);
		const snapshot = await register.getMetricsAsJSON();
		expect(snapshot.find((metric) => metric.name === 'when_emails_total')?.values).toEqual([
			expect.objectContaining({
				labels: {
					app: 'when',
					service: 'worker',
					recipient_type: 'guest',
					email_kind: 'confirmed',
					status: 'success'
				},
				value: 1
			})
		]);
		expect(
			snapshot
				.find((metric) => metric.name === 'when_operation_failures_total')
				?.values.filter(({ labels }) => labels.operation === 'smtp_send')
		).toEqual([]);
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
		const entries = await emailEntries();
		expect(entries).toEqual([]);
		const snapshot = await register.getMetricsAsJSON();
		expect(snapshot.find((metric) => metric.name === 'when_emails_total')?.values).toEqual([]);
		expect(
			snapshot
				.find((metric) => metric.name === 'when_operation_failures_total')
				?.values.filter(({ labels }) => labels.operation === 'smtp_send')
		).toEqual([]);
	});
});
