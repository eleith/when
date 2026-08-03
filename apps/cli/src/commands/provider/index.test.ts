import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { initOpenWorkflow, testProvider, listProviderCalendars } from '@when/jobs';
import { openDb, runMigrations, recordServiceOutcome } from '@when/db';
import { join as joinPath } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { providerCommand } from './index.ts';
import { listCommand } from './list.ts';
import { testCommand } from './test.ts';
import { calendarsCommand } from './calendars.ts';

vi.mock('@when/jobs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/jobs')>();
	return { ...actual, initOpenWorkflow: vi.fn() };
});

const handle = { result: vi.fn() };
const client = { runWorkflow: vi.fn() };

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
  - name: "gcal"
    type: "google"
    client_id: "cid"
    client_secret: "csecret"
  - name: "dav"
    type: "caldav"
    url: "https://dav.example.com/remote.php/dav/"
    username: "u"
    password: "p"
    calendars:
      - name: "work"
        url: "https://dav.example.com/remote.php/dav/calendars/u/work/"
  - name: "gcal-envref"
    type: "google"
    client_id: "cid2"
    client_secret: "\${WHEN_TEST_SVC_SECRET}"
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
    booking_approval: "instant"
    booking_calendar: "work"
    schedule: "standard"
database:
  app: "DB_PATH"
  queue: "./data/openworkflow.sqlite"
url:
  app: "https://book.example.com"
`;

const path = join(process.cwd(), 'temp-provider-config.yaml');
const dataDir = joinPath(tmpdir(), 'when-cli-provider-test');
const dbPath = joinPath(dataDir, 'when.sqlite');

function ctx(values: Record<string, unknown>) {
	return { values } as unknown as Parameters<NonNullable<typeof testCommand.run>>[0];
}

describe('provider command', () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;
	let originalExitCode: number | undefined;

	beforeEach(async () => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		originalExitCode = process.exitCode as number | undefined;
		process.exitCode = undefined;
		handle.result = vi.fn().mockResolvedValue('authenticated');
		client.runWorkflow = vi.fn().mockResolvedValue(handle);
		vi.mocked(initOpenWorkflow)
			.mockReset()
			.mockReturnValue(client as never);
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
		process.env.WHEN_TEST_SVC_SECRET = 'set';
		rmSync(dataDir, { recursive: true, force: true });
		const db = openDb(dbPath);
		await runMigrations(db);
		await db.destroy();
		writeFileSync(path, configYaml.replace('DB_PATH', dbPath));
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
		process.exitCode = originalExitCode;
		try {
			unlinkSync(path);
		} catch {
			/* ignore */
		}
		rmSync(dataDir, { recursive: true, force: true });
	});

	test('bare provider prints usage', () => {
		providerCommand.run!();
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('when-cli provider test <name>'));
	});

	test('list reads the stored status without reaching the provider', async () => {
		await listCommand.run!(ctx({ config: path }));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('gcal (google) — not yet observed');
		expect(logSpy).toHaveBeenCalledWith('dav (caldav) — not yet observed');
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});

	test('list reports a provider observed as working, and one observed as failing', async () => {
		const db = openDb(dbPath);
		await recordServiceOutcome(
			db,
			{ kind: 'provider', name: 'gcal' },
			{ at: 't1', via: 'refresh' }
		);
		await recordServiceOutcome(
			db,
			{ kind: 'provider', name: 'dav' },
			{ at: 't2', via: 'push', error: 'PROPFIND 401' }
		);
		await db.destroy();

		await listCommand.run!(ctx({ config: path }));

		expect(logSpy).toHaveBeenCalledWith('✅ gcal (google) — working, last confirmed t1');
		expect(errorSpy).toHaveBeenCalledWith('❌ dav (caldav) — failing since t2: PROPFIND 401');
	});

	test('test runs the probe in the worker', async () => {
		await testCommand.run!(ctx({ name: 'dav', config: path }));

		expect(process.exitCode).toBeUndefined();
		expect(client.runWorkflow).toHaveBeenCalledWith(
			testProvider,
			{ name: 'dav' },
			expect.objectContaining({ idempotencyKey: expect.any(String) })
		);
		expect(logSpy).toHaveBeenCalledWith('✅ dav (caldav) — authenticated');
	});

	test('test surfaces the failure the worker raised', async () => {
		handle.result = vi.fn().mockRejectedValue(new Error('bad credentials (401)'));

		await testCommand.run!(ctx({ name: 'dav', config: path }));

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('401'));
	});

	test('test names a stopped worker instead of hanging on the result poll', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

		await testCommand.run!(ctx({ name: 'dav', config: path }));

		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('worker unreachable'));
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});

	test('calendars lists what the worker discovered', async () => {
		handle.result = vi.fn().mockResolvedValue({
			field: 'path',
			calendars: [{ id: 'cal/1', name: 'Work', primary: false }]
		});

		await calendarsCommand.run!(ctx({ name: 'dav', config: path }));

		expect(client.runWorkflow).toHaveBeenCalledWith(
			listProviderCalendars,
			{ name: 'dav' },
			expect.anything()
		);
		expect(logSpy).toHaveBeenCalledWith('  path: cal/1  Work');
	});

	test('calendars reports an empty list as a success', async () => {
		handle.result = vi.fn().mockResolvedValue({ field: 'path', calendars: [] });

		await calendarsCommand.run!(ctx({ name: 'dav', config: path }));

		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('✅ dav (caldav) — no calendars found');
	});

	test('test requires a provider name', async () => {
		await testCommand.run!(ctx({ config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires a provider name'));
	});

	test('unknown provider name fails', async () => {
		await testCommand.run!(ctx({ name: 'nope', config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no provider named "nope"'));
	});

	test('an unset env var anywhere in the config is named, before any provider work', async () => {
		delete process.env.WHEN_TEST_SVC_SECRET;
		await testCommand.run!(ctx({ name: 'dav', config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('WHEN_TEST_SVC_SECRET'));
		expect(client.runWorkflow).not.toHaveBeenCalled();
	});
});
