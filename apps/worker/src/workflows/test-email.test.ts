import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb, runMigrations, listServiceStatus } from '@when/db';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import type { Mailer, SendResult } from '../email/smtp.js';
import { sampleConfig } from '../email/__fixtures__/appointment.js';
import { runTestEmail } from './test-email.js';

vi.mock('../email/logo.js', () => ({ fetchBrandLogo: vi.fn().mockResolvedValue(null) }));

let db: WorkerContext['db'];

function setContext(result: SendResult): ReturnType<typeof vi.fn> {
	const sendFn = vi.fn().mockResolvedValue(result);
	const mailer: Mailer = { send: sendFn };
	setWorkerContext({ config: sampleConfig, logger: createLogger(), db, mailer });
	return sendFn;
}

describe('runTestEmail', () => {
	beforeEach(async () => {
		db = openDb(':memory:');
		await runMigrations(db);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await db.destroy();
	});

	test('renders and sends the test email, returning "sent"', async () => {
		const send = setContext({ ok: true });
		const observedAt = '2026-02-01T12:01:00.000Z';
		let now = '2026-02-01T12:00:00.000Z';
		const clock = { now: () => new Date(now) };
		send.mockImplementation(async () => {
			now = observedAt;
			return { ok: true };
		});
		const result = await runTestEmail({ to: 'me@example.com' }, clock);
		expect(result).toBe('sent');
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'me@example.com',
				subject: expect.stringContaining('Test email')
			})
		);
		const [smtp] = await listServiceStatus(db, 'smtp');
		expect(smtp.last_attempt_at).toBe(observedAt);
		expect(smtp.last_ok_at).toBe(observedAt);
	});

	test('throws when the mailer reports failure', async () => {
		setContext({ ok: false, reason: 'SMTP 535 auth failed' });
		const observedAt = '2026-02-01T12:01:00.000Z';
		const clock = { now: () => new Date(observedAt) };
		await expect(runTestEmail({ to: 'me@example.com' }, clock)).rejects.toThrow(
			'SMTP 535 auth failed'
		);
		const [smtp] = await listServiceStatus(db, 'smtp');
		expect(smtp.last_attempt_at).toBe(observedAt);
		expect(smtp.failing_since).toBe(observedAt);
	});
});
