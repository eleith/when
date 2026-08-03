import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { initOpenWorkflow } from '@when/jobs';
import { emailCommand } from './index.ts';
import { testCommand } from './test.ts';

vi.mock('@when/jobs', () => ({
	initOpenWorkflow: vi.fn(),
	testEmail: { name: 'test-email' }
}));

const configYaml = `
auth:
  credentials:
    username: "admin"
    password: "pw"
user:
  name: "Jane Doe"
  email: "jane@example.com"
  timezone: "America/New_York"
smtp:
  host: "smtp.example.com"
  port: 587
  user: "smtp_user"
  pass: "smtp_pass"
providers:
  - name: "dav"
    type: "caldav"
    url: "https://dav.example.com/"
    username: "u"
    password: "p"
    calendars:
      - name: "work"
        href: "https://dav.example.com/calendars/u/work/"
schedules:
  - name: "standard"
    weekly:
      - days: [mon]
        from: "09:00"
        to: "17:00"
meetings:
  - name: "chat"
    duration_minutes: 30
    slug: "chat"
    require_approval: false
    booking_calendar: "work"
    schedule: "standard"
database:
  app: "./data/when.sqlite"
  queue: "./data/openworkflow.sqlite"
url:
  app: "https://book.example.com"
  worker: "http://localhost:9099"
`;

const path = join(process.cwd(), 'temp-email-config.yaml');

function ctx(values: Record<string, unknown>) {
	return { values } as unknown as Parameters<NonNullable<typeof testCommand.run>>[0];
}

function mockWorkflow(result: () => Promise<unknown>) {
	const runWorkflow = vi.fn().mockResolvedValue({ result: vi.fn(result) });
	vi.mocked(initOpenWorkflow).mockReturnValue({
		runWorkflow
	} as unknown as ReturnType<typeof initOpenWorkflow>);
	return runWorkflow;
}

describe('email command', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		vi.mocked(initOpenWorkflow).mockReset();
		writeFileSync(path, configYaml);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = originalExitCode;
		try {
			unlinkSync(path);
		} catch {
			/* ignore */
		}
	});

	test('bare email prints usage', () => {
		emailCommand.run!();
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('when-cli email test <address>'));
	});

	test('test without an address fails', async () => {
		await testCommand.run!(ctx({ config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires a recipient address'));
	});

	test('sends the test email when the worker is reachable and the job succeeds', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
		const runWorkflow = mockWorkflow(async () => 'sent');
		await testCommand.run!(ctx({ address: 'me@example.com', config: path }));
		expect(process.exitCode).toBeUndefined();
		expect(runWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'test-email' }),
			{ to: 'me@example.com' },
			expect.objectContaining({ idempotencyKey: expect.any(String) })
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining('✅ test email sent to me@example.com')
		);
	});

	test('does not enqueue when the worker is unreachable', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
		await testCommand.run!(ctx({ address: 'me@example.com', config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('worker unreachable'));
		expect(initOpenWorkflow).not.toHaveBeenCalled();
	});

	test('reports failure when the job fails', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
		mockWorkflow(async () => {
			throw new Error('SMTP 535');
		});
		await testCommand.run!(ctx({ address: 'me@example.com', config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('test email failed'));
	});
});
