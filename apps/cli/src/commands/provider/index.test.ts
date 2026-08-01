import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { getProviderAdapter } from '@when/calendar';
import {
	openDb,
	runMigrations,
	recordServiceOutcome,
	listServiceStatus,
	saveProviderRefreshToken
} from '@when/db';
import { join as joinPath } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { providerCommand } from './index.ts';
import { listCommand } from './list.ts';
import { testCommand } from './test.ts';

vi.mock('@when/calendar', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@when/calendar')>();
	return { ...actual, getProviderAdapter: vi.fn() };
});

const adapter = { calendarIdField: 'x', usesOAuth: true, verify: vi.fn(), listCalendars: vi.fn() };

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
  - name: "gcal-envref"
    type: "google"
    client_id: "cid2"
    client_secret: "\${WHEN_TEST_SVC_SECRET}"
calendars:
  - name: "work"
    type: "caldav"
    provider: "dav"
    url: "https://dav.example.com/remote.php/dav/calendars/u/work/"
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
		adapter.verify = vi.fn().mockResolvedValue(undefined);
		adapter.listCalendars = vi.fn().mockResolvedValue([]);
		vi.mocked(getProviderAdapter)
			.mockReset()
			.mockImplementation((provider) => ({ ...adapter, usesOAuth: provider.type === 'google' }));
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
		expect(getProviderAdapter).not.toHaveBeenCalled();
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

	test('a passing test is recorded, so the admin sees it too', async () => {
		await testCommand.run!(ctx({ name: 'dav', config: path }));
		expect(process.exitCode).toBeUndefined();

		const db = openDb(dbPath);
		const [status] = await listServiceStatus(db, 'provider');
		await db.destroy();
		expect(status).toMatchObject({ name: 'dav', via: 'test', error: null });
	});

	test('a failing test records the reason', async () => {
		adapter.verify = vi.fn().mockRejectedValue(new Error('bad credentials (401)'));
		await testCommand.run!(ctx({ name: 'dav', config: path }));

		const db = openDb(dbPath);
		const [status] = await listServiceStatus(db, 'provider');
		await db.destroy();
		expect(status.error).toContain('401');
		expect(status.failing_since).toBeTruthy();
	});

	test('test requires a provider name', async () => {
		await testCommand.run!(ctx({ config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('requires a provider name'));
	});

	test('google test verifies through the adapter', async () => {
		await testCommand.run!(ctx({ name: 'gcal', config: path, refreshToken: 'rtok' }));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('✅ gcal (google) — authenticated');
		expect(getProviderAdapter).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'gcal', refresh_token: 'rtok' })
		);
	});

	test('google test reads the stored refresh token instead of demanding a flag', async () => {
		const db = openDb(dbPath);
		await saveProviderRefreshToken(db, 'gcal', 'stored-rt');
		await db.destroy();

		await testCommand.run!(ctx({ name: 'gcal', config: path }));

		expect(process.exitCode).toBeUndefined();
		expect(getProviderAdapter).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'gcal', refresh_token: 'stored-rt' })
		);
	});

	test('google test says to connect when no token is stored', async () => {
		await testCommand.run!(ctx({ name: 'gcal', config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not connected'));
		expect(adapter.verify).not.toHaveBeenCalled();
	});

	test('google test fails when the token refresh throws', async () => {
		adapter.verify = vi.fn().mockRejectedValue(new Error('Google token refresh failed: 400'));
		await testCommand.run!(ctx({ name: 'gcal', config: path, refreshToken: 'rtok' }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('❌ gcal (google)'));
	});

	test('caldav test passes when the adapter verifies', async () => {
		await testCommand.run!(ctx({ name: 'dav', config: path }));
		expect(process.exitCode).toBeUndefined();
		expect(logSpy).toHaveBeenCalledWith('✅ dav (caldav) — authenticated');
	});

	test('caldav test reports the failure reason', async () => {
		adapter.verify = vi.fn().mockRejectedValue(new Error('bad credentials (401)'));
		await testCommand.run!(ctx({ name: 'dav', config: path }));
		expect(process.exitCode).toBe(1);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad credentials (401)'));
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
		expect(adapter.verify).not.toHaveBeenCalled();
	});
});
