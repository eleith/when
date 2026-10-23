import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getOpenWorkflow, testEmail } from '@when/jobs';
import { openDb, runMigrations, recordServiceOutcome, type Database } from '@when/db';
import type { Kysely } from 'kysely';
import type { WhenConfiguration } from '@when/config';
import { sendTestEmail, smtpSummary } from './status';

vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, getOpenWorkflow: vi.fn() };
});

const config = {
	smtp: { host: 'smtp.example.com', port: 587, username: 'postmaster' },
	user: { email: 'jane@example.com' },
	url: { app: 'https://book.example.com', worker: 'http://when-worker:9000' }
} as unknown as WhenConfiguration;

const handle = { result: vi.fn(), cancel: vi.fn() };
const client = { runWorkflow: vi.fn() };
let db: Kysely<Database>;

beforeEach(async () => {
	db = openDb(':memory:');
	await runMigrations(db);
	handle.result = vi.fn().mockResolvedValue('sent');
	handle.cancel.mockReset();
	client.runWorkflow = vi.fn().mockResolvedValue(handle);
	vi.mocked(getOpenWorkflow)
		.mockReset()
		.mockReturnValue(client as never);
	vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await db.destroy();
});

describe('smtpSummary', () => {
	test('reports the configured server without reaching it', async () => {
		const summary = await smtpSummary(config, db);
		expect(summary).toMatchObject({
			host: 'smtp.example.com',
			port: 587,
			username: 'postmaster'
		});
		expect(getOpenWorkflow).not.toHaveBeenCalled();
	});

	test('derives the sender address the app actually sends as', async () => {
		const summary = await smtpSummary(config, db);
		expect(summary.sender).toBe('noreply@book.example.com');
	});

	test('offers the host as the default recipient', async () => {
		const summary = await smtpSummary(config, db);
		expect(summary.defaultRecipient).toBe('jane@example.com');
	});

	test('never exposes the smtp password', async () => {
		const withPassword = { ...config, smtp: { ...config.smtp, password: 'hunter2' } };
		const view = await smtpSummary(withPassword as WhenConfiguration, db);
		expect(JSON.stringify(view)).not.toContain('hunter2');
	});

	test('smtp reads as unobserved until an email has been sent', async () => {
		const summary = await smtpSummary(config, db);
		expect(summary.observed.state).toBe('unobserved');
	});

	test('a sent email is what makes smtp read as working', async () => {
		await recordServiceOutcome(
			db,
			{ kind: 'smtp' },
			{
				at: Temporal.Now.instant().toString(),
				via: 'send'
			}
		);

		const { observed } = await smtpSummary(config, db);
		expect(observed.state).toBe('working');
		expect(observed.via).toBe('send');
	});

	test('a failed send surfaces the reason on the card', async () => {
		await recordServiceOutcome(
			db,
			{ kind: 'smtp' },
			{
				at: Temporal.Now.instant().toString(),
				via: 'send',
				error: 'EAUTH'
			}
		);

		const { observed } = await smtpSummary(config, db);
		expect(observed.state).toBe('failing');
		expect(observed.error).toBe('EAUTH');
	});
});

describe('sendTestEmail', () => {
	test('runs the same workflow the CLI does', async () => {
		const result = await sendTestEmail(config, 'someone@example.com');

		expect(result).toEqual({ ok: true, message: 'Test email sent to someone@example.com.' });
		expect(handle.result).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 30_000 });
		expect(client.runWorkflow).toHaveBeenCalledExactlyOnceWith(
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
		const result = await sendTestEmail(config, '  ');
		expect(result).toMatchObject({ ok: false });
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});

	test.each([
		'Timed out waiting for workflow run 123 to finish',
		'Workflow test-email failed: 535 auth failed',
		'Workflow test-email was canceled',
		'Workflow run 123 no longer exists'
	])('preserves "%s" as test feedback without retrying', async (message) => {
		handle.result.mockRejectedValue(new Error(message));

		const result = await sendTestEmail(config, 'someone@example.com');

		expect(result).toEqual({ ok: false, message });
		expect(client.runWorkflow).toHaveBeenCalledTimes(1);
		expect(handle.result).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 30_000 });
		expect(handle.cancel).not.toHaveBeenCalled();
		const observations = await db.selectFrom('service_status').selectAll().execute();
		expect(observations).toEqual([]);
	});

	test('surfaces a queue that will not accept the run', async () => {
		client.runWorkflow.mockRejectedValue(new Error('queue unavailable'));

		const result = await sendTestEmail(config, 'someone@example.com');

		expect(result).toEqual({ ok: false, message: 'queue unavailable' });
		expect(client.runWorkflow).toHaveBeenCalledTimes(1);
		expect(handle.result).not.toHaveBeenCalled();
	});

	// An unclaimed run sits pending until the result poll gives up half a minute later.
	test('says the worker is down instead of waiting for the result to time out', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

		const result = await sendTestEmail(config, 'someone@example.com');

		expect(result).toMatchObject({ ok: false });
		expect(result.message).toContain('Worker not reachable');
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});

	test('treats an unhealthy worker as unreachable', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));

		const result = await sendTestEmail(config, 'someone@example.com');
		expect(result).toMatchObject({ ok: false });
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});
});
