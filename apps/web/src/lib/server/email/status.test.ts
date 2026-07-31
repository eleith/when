import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getOpenWorkflow, testEmail } from '@when/jobs';
import type { WhenConfiguration } from '@when/config';
import { sendTestEmail, smtpSummary } from './status';

vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: vi.fn() };
});

const config = {
	smtp: { host: 'smtp.example.com', port: 587, user: 'postmaster' },
	user: { email: 'jane@example.com' },
	url: { app: 'https://book.example.com', worker: 'http://when-worker:9000' }
} as unknown as WhenConfiguration;

const handle = { result: vi.fn() };
const client = { runWorkflow: vi.fn() };

beforeEach(() => {
	handle.result = vi.fn().mockResolvedValue('sent');
	client.runWorkflow = vi.fn().mockResolvedValue(handle);
	vi.mocked(getOpenWorkflow)
		.mockReset()
		.mockReturnValue(client as never);
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
});

describe('smtpSummary', () => {
	test('reports the configured server without reaching it', () => {
		expect(smtpSummary(config)).toMatchObject({
			host: 'smtp.example.com',
			port: 587,
			user: 'postmaster'
		});
		expect(getOpenWorkflow).not.toHaveBeenCalled();
	});

	test('derives the sender address the app actually sends as', () => {
		expect(smtpSummary(config).sender).toBe('noreply@book.example.com');
	});

	test('offers the host as the default recipient', () => {
		expect(smtpSummary(config).defaultRecipient).toBe('jane@example.com');
	});

	test('never exposes the smtp password', () => {
		const withPassword = { ...config, smtp: { ...config.smtp, pass: 'hunter2' } };
		expect(JSON.stringify(smtpSummary(withPassword as WhenConfiguration))).not.toContain('hunter2');
	});
});

describe('sendTestEmail', () => {
	test('runs the same workflow the CLI does', async () => {
		const result = await sendTestEmail(config, 'someone@example.com');

		expect(result).toEqual({ ok: true, message: 'Test email sent to someone@example.com.' });
		expect(client.runWorkflow).toHaveBeenCalledWith(
			testEmail,
			{ to: 'someone@example.com' },
			expect.objectContaining({ idempotencyKey: expect.any(String) })
		);
	});

	// Each send is a fresh request, so queue dedup must not swallow a retry.
	test('gives every send a distinct idempotency key', async () => {
		await sendTestEmail(config, 'someone@example.com');
		await sendTestEmail(config, 'someone@example.com');

		const [first, second] = client.runWorkflow.mock.calls.map((c) => c[2].idempotencyKey);
		expect(first).not.toBe(second);
	});

	test('refuses an empty recipient without touching the queue', async () => {
		expect(await sendTestEmail(config, '  ')).toMatchObject({ ok: false });
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});

	test('surfaces a worker failure', async () => {
		handle.result = vi.fn().mockRejectedValue(new Error('535 auth failed'));

		expect(await sendTestEmail(config, 'someone@example.com')).toEqual({
			ok: false,
			message: '535 auth failed'
		});
	});

	test('surfaces a queue that will not accept the run', async () => {
		client.runWorkflow = vi.fn().mockRejectedValue(new Error('queue unavailable'));

		expect(await sendTestEmail(config, 'someone@example.com')).toMatchObject({ ok: false });
	});

	// An unclaimed run sits pending until the result poll gives up half a minute later.
	test('says the worker is down instead of waiting for the result to time out', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

		const result = await sendTestEmail(config, 'someone@example.com');

		expect(result).toMatchObject({ ok: false });
		expect(result.message).toContain('worker is not reachable');
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});

	test('treats an unhealthy worker as unreachable', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));

		expect(await sendTestEmail(config, 'someone@example.com')).toMatchObject({ ok: false });
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});
});
