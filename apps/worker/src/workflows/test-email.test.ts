import { afterEach, describe, expect, test, vi } from 'vitest';
import { setWorkerContext, type WorkerContext } from '../services/context.js';
import { createLogger } from '../services/logger.js';
import type { Mailer, SendResult } from '../email/smtp.js';
import { sampleConfig } from '../email/__fixtures__/appointment.js';
import { runTestEmail } from './test-email.js';

vi.mock('../email/logo.js', () => ({ fetchBrandLogo: vi.fn().mockResolvedValue(null) }));

function setContext(result: SendResult): ReturnType<typeof vi.fn> {
	const sendFn = vi.fn().mockResolvedValue(result);
	const mailer: Mailer = { send: sendFn };
	setWorkerContext({
		config: sampleConfig,
		logger: createLogger(),
		db: {} as WorkerContext['db'],
		mailer
	});
	return sendFn;
}

describe('runTestEmail', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('renders and sends the test email, returning "sent"', async () => {
		const send = setContext({ ok: true });
		const result = await runTestEmail({ to: 'me@example.com' });
		expect(result).toBe('sent');
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				to: 'me@example.com',
				subject: expect.stringContaining('Test email')
			})
		);
	});

	test('throws when the mailer reports failure', async () => {
		setContext({ ok: false, reason: 'SMTP 535 auth failed' });
		await expect(runTestEmail({ to: 'me@example.com' })).rejects.toThrow('SMTP 535 auth failed');
	});
});
